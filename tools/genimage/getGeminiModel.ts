const MODEL_FLASH = "google/gemini-2.5-flash-image";
const MODEL_PRO = "google/gemini-3-pro-image-preview";

export const getGeminiModel = (usePro: boolean) => {
  return usePro ? MODEL_PRO : MODEL_FLASH;
};
