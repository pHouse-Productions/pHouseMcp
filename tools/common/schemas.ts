import { z } from "zod";

// Common types
export const AspectRatioSchema = z.enum([
  "1:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
]);

export const ImageSizeSchema = z.enum(["1K", "2K", "4K"]);

export type AspectRatio = z.infer<typeof AspectRatioSchema>;
export type ImageSize = z.infer<typeof ImageSizeSchema>;

// Shared image generation options
export const SharedImageOptionsSchema = z.object({
  aspectRatio: AspectRatioSchema.default("1:1"),
  imageSize: ImageSizeSchema.default("1K"),
  usePro: z.boolean().default(false),
});

export type SharedImageOptions = z.infer<typeof SharedImageOptionsSchema>;

// Generate image schema
export const GenerateImageSchema = z
  .object({
    prompt: z.string(),
    outputPath: z.string(),
  })
  .merge(SharedImageOptionsSchema.partial());

export type GenerateImageOptions = z.infer<typeof GenerateImageSchema>;

// Edit image schema
export const EditImageSchema = z
  .object({
    prompt: z.string(),
    inputImage: z.string(),
    outputPath: z.string(),
  })
  .merge(SharedImageOptionsSchema.partial());

export type EditImageOptions = z.infer<typeof EditImageSchema>;
