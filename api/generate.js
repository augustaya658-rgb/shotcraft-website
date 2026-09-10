export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  const { imageBase64, prompt, tier, ratio } = req.body || {};

  if (!imageBase64 || !prompt) {
    return res.status(400).json({
      error: "Image aur prompt dono chahiye"
    });
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  try {
    // --------------------------------------------------
    // 1. BASE64 IMAGE KO BINARY ME CONVERT KARO
    // --------------------------------------------------

    const match = imageBase64.match(
      /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/
    );

    if (!match) {
      return res.status(400).json({
        error: "Invalid image format"
      });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const imageBuffer = Buffer.from(base64Data, "base64");

    if (!imageBuffer.length) {
      return res.status(400).json({
        error: "Image data is empty"
      });
    }

    // --------------------------------------------------
    // 2. IMAGE REPLICATE FILES API PAR UPLOAD KARO
    // --------------------------------------------------

    const extension =
      mimeType === "image/png"
        ? "png"
        : mimeType === "image/webp"
        ? "webp"
        : "jpg";

    const form = new FormData();

    form.append(
      "content",
      new Blob([imageBuffer], {
        type: mimeType
      }),
      `product.${extension}`
    );

    const uploadResponse = await fetch(
      "https://api.replicate.com/v1/files",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`
        },

        body: form
      }
    );

    const uploadResult = await uploadResponse.json();

    if (!uploadResponse.ok) {
      return res.status(500).json({
        error: "Image upload to Replicate failed",
        details: uploadResult
      });
    }

    const hostedImageUrl = uploadResult?.urls?.get;

    if (!hostedImageUrl) {
      return res.status(500).json({
        error: "Replicate did not return an image URL",
        details: uploadResult
      });
    }

    // --------------------------------------------------
    // 3. QUALITY SETTINGS
    // --------------------------------------------------

    const quality =
      {
        basic: 70,
        standard: 85,
        hd: 95
      }[tier] || 85;

    // --------------------------------------------------
    // 4. VALID RATIO
    // --------------------------------------------------

    const validRatios = [
      "1:1",
      "4:5",
      "16:9",
      "9:16",
      "3:2",
      "2:3",
      "4:3",
      "3:4"
    ];

    const finalRatio = validRatios.includes(ratio)
      ? ratio
      : "1:1";

    // --------------------------------------------------
    // 5. FLUX 1.1 PRO GENERATION
    // --------------------------------------------------

    const replicateResponse = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
      {
        method: "POST",

        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait=10",
          "Cancel-After": "90s"
        },

        body: JSON.stringify({
          input: {
            prompt: prompt,

            // IMPORTANT:
            // Ab Base64 nahi.
            // Replicate hosted file URL use hoga.
            image_prompt: hostedImageUrl,

            aspect_ratio: finalRatio,

            output_format: "jpg",

            output_quality: quality
          }
        })
      }
    );

    let result = await replicateResponse.json();

    if (!replicateResponse.ok) {
      return res.status(500).json({
        error: "Replicate generation request failed",
        details: result
      });
    }

    // --------------------------------------------------
    // 6. POLL PREDICTION
    // --------------------------------------------------

    const deadline = Date.now() + 80000;

    while (
      result.status !== "succeeded" &&
      result.status !== "failed" &&
      result.status !== "canceled"
    ) {
      if (Date.now() > deadline) {
        return res.status(504).json({
          error: "Generation timed out",
          predictionId: result.id
        });
      }

      await new Promise((resolve) =>
        setTimeout(resolve, 1000)
      );

      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${result.id}`,
        {
          headers: {
            Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`
          }
        }
      );

      result = await pollResponse.json();
    }

    // --------------------------------------------------
    // 7. GENERATION FAILED
    // --------------------------------------------------

    if (result.status !== "succeeded") {
      return res.status(500).json({
        error: "Image generation failed",
        details: result.error || result.status,
        predictionId: result.id
      });
    }

    // --------------------------------------------------
    // 8. GET OUTPUT IMAGE
    // --------------------------------------------------

    const imageUrl = Array.isArray(result.output)
      ? result.output[0]
      : result.output;

    if (!imageUrl) {
      return res.status(500).json({
        error: "Replicate returned no image",
        predictionId: result.id
      });
    }

    // --------------------------------------------------
    // 9. SUCCESS
    // --------------------------------------------------

    return res.status(200).json({
      imageUrl,
      predictionId: result.id,
      tier: tier || "standard",
      ratio: finalRatio,
      model: "black-forest-labs/flux-1.1-pro"
    });

  } catch (err) {
    console.error("SHOTCRAFT GENERATION ERROR:", err);

    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
