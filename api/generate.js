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

  // Quality tier settings
  const TIER_SETTINGS = {
    basic: { steps: 25, base: 768 },
    standard: { steps: 35, base: 1024 },
    hd: { steps: 50, base: 1280 },
  };
  const settings = TIER_SETTINGS[tier] || TIER_SETTINGS.standard;

  // Ratio -> width/height (base resolution ko ratio ke hisaab se adjust karta hai)
  const RATIOS = {
    "1:1": { w: 1, h: 1 },
    "4:5": { w: 4, h: 5 },
    "16:9": { w: 16, h: 9 },
    "9:16": { w: 9, h: 16 },
  };
  const r = RATIOS[ratio] || RATIOS["1:1"];
  const base = settings.base;
  const width = r.w >= r.h ? base : Math.round(base * (r.w / r.h));
  const height = r.h >= r.w ? base : Math.round(base * (r.h / r.w));

  try {
    const replicateResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "black-forest-labs/flux-1.1-pro",
        input: {
          prompt: prompt,
          image: imageBase64,
          width,
          height,
          num_inference_steps: settings.steps,
        },
      }),
    });

    const prediction = await replicateResponse.json();

    if (!replicateResponse.ok) {
      return res.status(500).json({ error: "Replicate API error", details: prediction });
    }

    let result = prediction;
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
