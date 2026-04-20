export async function generateHordeImage(prompt: string): Promise<string> {
  // Alice requested anime style appended automatically
  const enhancedPrompt = prompt + ", high quality anime style digital art, highly detailed";

  const payload = {
    prompt: enhancedPrompt,
    params: {
      n: 1,
      width: 1024,
      height: 1024,
      steps: 30,
    },
    censor_nsfw: false, // We stay feral in this household
    models: ["DreamShaper V9", "AlbedoBase XL (SDXL)", "CyberRealistic Pony", "stable_diffusion", "AlbedoBase XL 3.1", "WAI-NSFW-illustrious-SDXL", "Deliberate", "Grapefruit Hentai"] // God-tier anime model
  };

  const response = await fetch("https://aihorde.net/api/v2/generate/async", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": process.env.HORDE_API_KEY || "0000000000",
    },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!data.id) throw new Error("Failed to start generation on AI Horde.");

  const id = data.id;

  // Poll the API every 5 seconds until the distributed workers finish the image
  while (true) {
    await new Promise(resolve => setTimeout(resolve, 5000));
    const checkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${id}`);
    const checkData = await checkRes.json();

    if (checkData.faulted) throw new Error("Generation faulted on worker.");
    if (checkData.done) break;
  }

  // Get final image URL
  const statusRes = await fetch(`https://aihorde.net/api/v2/generate/status/${id}`);
  const statusData = await statusRes.json();

  if (statusData.generations && statusData.generations.length > 0) {
    return statusData.generations[0].img; // Returns the URL
  }

  throw new Error("No image returned from Horde.");
}
