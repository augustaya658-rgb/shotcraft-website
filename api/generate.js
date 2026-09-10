export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageBase64, prompt, tier, ratio } = req.body || {};

  if (!imageBase64 || !prompt) {
    return res.status(400).json({
      error: "Image aur prompt dono chahiye"
    });
  }

  if (
    typeof imageBase64 !== "string" ||
    imageBase64.length > 18 * 1024 * 1024
  ) {
    return res.status(413).json({
      error: "Image payload too large"
    });
  }

  if (!process.env.REPLICATE_API_TOKEN) {
    return res.status(500).json({
      error: "REPLICATE_API_TOKEN is not configured"
    });
  }

  const quality =
    {
      basic: 70,
      standard: 85,
      hd: 95
    }[tier] || 85;

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

  try {
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
            image_prompt: imageBase64,
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
        error: "Replicate API error",
        details: result
      });
    }

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

    if (result.status !== "succeeded") {
      return res.status(500).json({
        error: "Image generation failed",
        details: result.error || result.status,
        predictionId: result.id
      });
    }

    const imageUrl = Array.isArray(result.output)
      ? result.output[0]
      : result.output;

    if (!imageUrl) {
      return res.status(500).json({
        error: "Replicate returned no image",
        predictionId: result.id
      });
    }

    return res.status(200).json({
      imageUrl: imageUrl,
      predictionId: result.id,
      tier: tier || "standard",
      ratio: finalRatio,
      model: "black-forest-labs/flux-1.1-pro"
    });

  } catch (err) {
    return res.status(500).json({
      error: "Server error",
      details: err.message
    });
  }
}
