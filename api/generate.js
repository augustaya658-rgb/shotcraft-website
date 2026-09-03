// FILE PATH: api/generate.js
// Ye poori PURANI generate.js file ko REPLACE kar degi (same jagah, same naam)

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageBase64, prompt, tier, ratio } = req.body;

  if (!imageBase64 || !prompt) {
    return res.status(400).json({ error: "Image aur prompt dono chahiye" });
  }

  // Quality tier -> output_quality aur "raw" mode ka control
  const TIER_SETTINGS = {
    basic: { output_quality: 70, raw: false },
    standard: { output_quality: 85, raw: false },
    hd: { output_quality: 95, raw: true },
  };
  const settings = TIER_SETTINGS[tier] || TIER_SETTINGS.standard;

  // Flux sirf ye specific ratios accept karta hai
  const VALID_RATIOS = ["1:1", "4:5", "16:9", "9:16", "3:2", "2:3", "4:3", "3:4"];
  const finalRatio = VALID_RATIOS.includes(ratio) ? ratio : "1:1";

  try {
    // Official models ke liye seedha model-specific endpoint use hota hai — "version" field ki zaroorat nahi
    const replicateResponse = await fetch(
      "https://api.replicate.com/v1/models/black-forest-labs/flux-1.1-pro/predictions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
          "Content-Type": "application/json",
          Prefer: "wait", // Replicate ko turant result ka wait karne ko bolta hai (jab tak possible)
        },
        body: JSON.stringify({
          input: {
            prompt: prompt,
            image_prompt: imageBase64, // "image" nahi, "image_prompt" — Flux Redux feature
            aspect_ratio: finalRatio,
            output_format: "jpg",
            output_quality: settings.output_quality,
            raw: settings.raw,
          },
        }),
      }
    );

    let result = await replicateResponse.json();

    if (!replicateResponse.ok) {
      return res.status(500).json({ error: "Replicate API error", details: result });
    }

    // Agar "Prefer: wait" ke bawajood turant result nahi mila, to poll karo
    while (result.status !== "succeeded" && result.status !== "failed") {
      await new Promise((r) => setTimeout(r, 1000));
      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${result.id}`,
        { headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` } }
      );
      result = await pollResponse.json();
    }

    if (result.status === "failed") {
      return res.status(500).json({ error: "Image generation failed", details: result.error });
    }

    return res.status(200).json({ imageUrl: result.output });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
