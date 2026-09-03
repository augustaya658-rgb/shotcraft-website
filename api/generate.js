// FILE PATH: api/generate.js
// Ye file GitHub repo mein "api" naam ke folder ke andar honi chahiye
// Poora path: api/generate.js (root mein "api" folder banake usme ye file daalo)
// Vercel isko automatically ek backend endpoint bana dega: yoursite.com/api/generate

export default async function handler(req, res) {
  // Sirf POST request allow karo
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { imageBase64, prompt, tier } = req.body;

  if (!imageBase64 || !prompt) {
    return res.status(400).json({ error: "Image aur prompt dono chahiye" });
  }

  // Tier ke hisaab se settings (quality/ratio wali baat jo humne pehle discuss ki thi)
  const TIER_SETTINGS = {
    basic: { steps: 25, width: 768, height: 768 },
    standard: { steps: 35, width: 1024, height: 1024 },
    hd: { steps: 50, width: 1024, height: 1024 },
  };
  const settings = TIER_SETTINGS[tier] || TIER_SETTINGS.standard;

  try {
    // Replicate ko call karo
    const replicateResponse = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}`, // token yahan secretly use hota hai, kabhi frontend mein nahi jata
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: "black-forest-labs/flux-1.1-pro", // model
        input: {
          prompt: prompt,
          image: imageBase64,
          width: settings.width,
          height: settings.height,
          num_inference_steps: settings.steps,
        },
      }),
    });

    const prediction = await replicateResponse.json();

    if (!replicateResponse.ok) {
      return res.status(500).json({ error: "Replicate API error", details: prediction });
    }

    // Replicate turant result nahi deta, "prediction id" deta hai — usse poll karke result lena padta hai
    let result = prediction;
    while (result.status !== "succeeded" && result.status !== "failed") {
      await new Promise((r) => setTimeout(r, 1000)); // 1 second wait
      const pollResponse = await fetch(
        `https://api.replicate.com/v1/predictions/${result.id}`,
        {
          headers: { Authorization: `Bearer ${process.env.REPLICATE_API_TOKEN}` },
        }
      );
      result = await pollResponse.json();
    }

    if (result.status === "failed") {
      return res.status(500).json({ error: "Image generation failed" });
    }

    return res.status(200).json({ imageUrl: result.output });
  } catch (err) {
    return res.status(500).json({ error: "Server error", details: err.message });
  }
}
