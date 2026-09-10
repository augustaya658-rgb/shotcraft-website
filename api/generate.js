export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const {
    imageBase64,
    prompt,
    tier,
    ratio
  } = req.body || {};

  // -----------------------------------
  // BASIC VALIDATION
  // -----------------------------------

  if (!imageBase64 || !prompt) {
    return res.status(400).json({
      error: "Image aur prompt dono chahiye"
    });
  }

  if (typeof imageBase64 !== "string") {
    return res.status(400).json({
      error: "Invalid image data"
    });
  }

  // -----------------------------------
  // REPLICATE TOKEN CHECK
  // -----------------------------------

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  // -----------------------------------
  // IMAGE DATA URI PARSE
  // -----------------------------------

  let mimeType = "image/jpeg";
  let base64Data = imageBase64;

  const dataUriMatch = imageBase64.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
  );

  if (dataUriMatch) {
    mimeType = dataUriMatch[1];
    base64Data = dataUriMatch[2];
  }

  // Only allow supported image types
  const allowedMimeTypes = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif"
  ];

  if (!allowedMimeTypes.includes(mimeType)) {
    return res.status(400).json({
      error: "Unsupported image type",
      details: mimeType
    });
  }

  // -----------------------------------
  // BASE64 → BUFFER
  // -----------------------------------

  let imageBuffer;

  try {
    imageBuffer = Buffer.from(
      base64Data,
      "base64"
    );
  } catch (err) {
    return res.status(400).json({
      error: "Invalid base64 image"
    });
  }

  if (!imageBuffer || imageBuffer.length === 0) {
    return res.status(400).json({
      error: "Image data is empty"
    });
  }

  // -----------------------------------
  // SAFETY SIZE CHECK
  // -----------------------------------

  const MAX_IMAGE_SIZE =
    12 * 1024 * 1024;

  if (imageBuffer.length > MAX_IMAGE_SIZE) {
    return res.status(413).json({
      error:
        "Image too large. Please upload an image under 12MB."
    });
  }

  // -----------------------------------
  // FILE EXTENSION
  // -----------------------------------

  const extensionMap = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  const extension =
    extensionMap[mimeType] || "jpg";

  try {

    // ===================================
    // STEP 1
    // UPLOAD PRODUCT IMAGE TO REPLICATE
    // ===================================

    const form = new FormData();

    const imageBlob = new Blob(
      [imageBuffer],
      {
        type: mimeType
      }
    );

    form.append(
      "content",
      imageBlob,
      `product.${extension}`
    );

    const uploadResponse = await fetch(
      "https://api.replicate.com/v1/files",
      {
        method: "POST",

        headers: {
          Authorization:
            `Bearer ${process.env.REPLICATE_API_TOKEN}`
        },

        body: form
      }
    );

    const uploadText =
      await uploadResponse.text();

    let uploadResult = {};

    try {
      uploadResult =
        JSON.parse(uploadText);
    } catch {
      uploadResult = {
        error: uploadText
      };
    }

    if (!uploadResponse.ok) {
      console.error(
        "REPLICATE FILE UPLOAD ERROR:",
        uploadResult
      );

      return res.status(500).json({
        error:
          "Replicate image upload failed",
        details: uploadResult
      });
    }

    const hostedImageUrl =
      uploadResult?.urls?.get;

    if (!hostedImageUrl) {
      console.error(
        "NO HOSTED IMAGE URL:",
        uploadResult
      );

      return res.status(500).json({
        error:
          "Replicate did not return image URL",
        details: uploadResult
      });
    }

    console.log(
      "PRODUCT IMAGE UPLOADED:",
      hostedImageUrl
    );

    // ===================================
    // STEP 2
    // VALIDATE RATIO
    // ===================================

    const validRatios = [
      "1:1",
      "4:5",
      "16:9",
      "9:16"
    ];

    const finalRatio =
      validRatios.includes(ratio)
        ? ratio
        : "1:1";

    // ===================================
    // STEP 3
    // OUTPUT QUALITY
    // ===================================

    const quality =
      {
        basic: 70,
        standard: 85,
        hd: 95
      }[tier] || 85;

    // ===================================
    // STEP 4
    // CREATE FLUX 1.1 PRO PREDICTION
    // ===================================

    const replicateResponse =
      await fetch(
        "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
        {
          method: "POST",

          headers: {
            Authorization:
              `Bearer ${process.env.REPLICATE_API_TOKEN}`,

            "Content-Type":
              "application/json",

            Prefer: "wait=10",

            "Cancel-After": "90s"
          },

          body: JSON.stringify({
            input: {

              prompt,

              image_prompt:
                hostedImageUrl,

              aspect_ratio:
                finalRatio,

              output_format:
                "jpg",

              output_quality:
                quality,

              safety_tolerance:
                2,

              prompt_upsampling:
                true
            }
          })
        }
      );

    // ===================================
    // STEP 5
    // READ REPLICATE RESPONSE
    // ===================================

    const predictionText =
      await replicateResponse.text();

    let result = {};

    try {
      result =
        JSON.parse(predictionText);
    } catch {
      result = {
        error: predictionText
      };
    }

    if (!replicateResponse.ok) {

      console.error(
        "REPLICATE PREDICTION ERROR:",
        result
      );

      return res.status(500).json({
        error:
          "Replicate prediction failed",

        details:
          result
      });
    }

    if (!result.id) {
      return res.status(500).json({
        error:
          "Replicate did not return prediction ID",

        details:
          result
      });
    }

    console.log(
      "PREDICTION CREATED:",
      result.id
    );

    // ===================================
    // STEP 6
    // POLL PREDICTION
    // ===================================

    const deadline =
      Date.now() + 85000;

    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      result.status !== "canceled"
    ) {

      if (Date.now() > deadline) {

        return res.status(504).json({
          error:
            "Generation timed out",

          predictionId:
            result.id
        });
      }

      await new Promise(
        resolve =>
          setTimeout(resolve, 1500)
      );

      const pollResponse =
        await fetch(
          `https://api.replicate.com/v1/predictions/${result.id}`,
          {
            method: "GET",

            headers: {
              Authorization:
                `Bearer ${process.env.REPLICATE_API_TOKEN}`
            }
          }
        );

      const pollText =
        await pollResponse.text();

      try {
        result =
          JSON.parse(pollText);
      } catch {
        result = {
          status: "failed",
          error: pollText
        };
      }

      console.log(
        "PREDICTION STATUS:",
        result.status
      );
    }

    // ===================================
    // STEP 7
    // FAILED / CANCELED
    // ===================================

    if (
      result.status !== "succeeded"
    ) {

      console.error(
        "GENERATION FAILED:",
        result
      );

      return res.status(500).json({

        error:
          "Image generation failed",

        details:
          result.error ||
          result.status,

        predictionId:
          result.id
      });
    }

    // ===================================
    // STEP 8
    // GET OUTPUT IMAGE
    // ===================================

    const imageUrl =
      Array.isArray(result.output)
        ? result.output[0]
        : result.output;

    if (!imageUrl) {

      console.error(
        "NO IMAGE OUTPUT:",
        result
      );

      return res.status(500).json({

        error:
          "Replicate returned no image",

        predictionId:
          result.id
      });
    }

    // ===================================
    // SUCCESS
    // ===================================

    console.log(
      "SHOTCRAFT GENERATION SUCCESS:",
      result.id
    );

    return res.status(200).json({

      imageUrl,

      predictionId:
        result.id,

      tier:
        tier || "standard",

      ratio:
        finalRatio,

      model:
        "black-forest-labs/flux-1.1-pro"
    });

  } catch (err) {

    console.error(
      "SHOTCRAFT SERVER ERROR:",
      err
    );

    return res.status(500).json({

      error:
        "Server error",

      details:
        err?.message ||
        String(err)
    });
  }
}
