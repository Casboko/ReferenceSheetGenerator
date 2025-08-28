/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import { GoogleGenAI, Modality } from "@google/genai";
import type { GenerateContentResponse, Part } from "@google/genai";
import { generatePrompt } from '../lib/prompts';

const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  throw new Error("API_KEY environment variable is not set");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// --- Helper Functions ---

/**
 * Converts a remote image URL or a local asset path into a data URL.
 * This is necessary because imported images are treated as paths by the bundler.
 * @param url The URL or path of the image.
 * @returns A promise that resolves to a data URL string.
 */
async function imageUrlToDataUrl(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image from ${url}: ${response.statusText}`);
    }
    let blob = await response.blob();

    // If the server doesn't provide a correct content-type, blob.type might be empty or generic.
    // We can try to infer it from the URL extension as a fallback.
    if (!blob.type || blob.type === 'application/octet-stream' || blob.type === '') {
        let mimeType = 'application/octet-stream'; // Default
        if (url.endsWith('.png')) mimeType = 'image/png';
        else if (url.endsWith('.jpg') || url.endsWith('.jpeg')) mimeType = 'image/jpeg';
        else if (url.endsWith('.webp')) mimeType = 'image/webp';
        
        // Re-create the blob with the correct MIME type if we were able to infer one.
        if (mimeType !== 'application/octet-stream') {
             blob = new Blob([blob], { type: mimeType });
        }
    }

    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

/**
 * Converts a data URL string into a Gemini-compatible part object.
 * @param dataUrl The data URL of the image.
 * @returns An object formatted for the Gemini API.
 */
function dataUrlToGeminiPart(dataUrl: string): Part {
    const match = dataUrl.match(/^data:(.+);base64,(.+)$/);
    if (!match) {
        throw new Error("Invalid image data URL format. Expected 'data:image/...;base64,...'");
    }
    const mimeType = match[1];
    const data = match[2];

    return {
        inlineData: {
            mimeType,
            data,
        },
    };
}

// --- Main Service Function ---

/**
 * Generates a reference image by combining a character design with a pose.
 * Can optionally accept an additional reference image for chained generation.
 * @param characterImageDataUrl The data URL of the user's uploaded character image.
 * @param poseImageUrl The path to the pose reference image.
 * @param poseName The name of the pose being generated.
 * @param additionalReferenceUrl (Optional) The data URL of an intermediate image (e.g., a generated portrait) to use as an additional reference.
 * @returns A promise that resolves to the data URL of the generated image.
 */
export async function generateReferenceImage(
    characterImageDataUrl: string, 
    poseImageUrl: string, 
    poseName: string,
    additionalReferenceUrl?: string
): Promise<string> {
    
    // Convert the pose image path to a data URL.
    const poseImageDataUrl = await imageUrlToDataUrl(poseImageUrl);

    // Prepare all image parts for the API call.
    const contentParts: Part[] = [
        dataUrlToGeminiPart(characterImageDataUrl), // Original character is always first
    ];

    // If an additional reference is provided (for the chained, 2-stage generation), add it.
    if (additionalReferenceUrl) {
        contentParts.push(dataUrlToGeminiPart(additionalReferenceUrl));
    }

    contentParts.push(dataUrlToGeminiPart(poseImageDataUrl)); // Pose reference is always last image

    // Generate the prompt, letting it know if this is a chained call.
    const prompt = generatePrompt(poseName, !!additionalReferenceUrl);
    contentParts.push({ text: prompt });

    // --- API Call with Retry Logic ---
    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response: GenerateContentResponse = await ai.models.generateContent({
                model: 'gemini-2.5-flash-image-preview',
                contents: contentParts, // Use the dynamically assembled content parts
                config: {
                    responseModalities: [Modality.IMAGE, Modality.TEXT],
                },
            });

            // Extract the generated image from the response.
            if (response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts) {
                for (const part of response.candidates[0].content.parts) {
                    if (part.inlineData) {
                        const base64ImageBytes: string = part.inlineData.data;
                        return `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
                    }
                }
            }
            
            // If no image is found in the response.
            throw new Error("The AI model did not return an image. Please try again.");

        } catch (error) {
            console.error(`Error calling Gemini API (Attempt ${attempt}/${maxRetries}):`, error);
            lastError = error instanceof Error ? error : new Error(String(error));
            if (attempt < maxRetries) {
                // Optional: Wait before retrying (e.g., exponential backoff)
                await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
            }
        }
    }
    
    // If all retries fail, throw a comprehensive error.
    const finalErrorMessage = `The AI model failed to generate an image for ${poseName}. Details: ${lastError?.message || 'Unknown error'}`;
    console.error(`An unrecoverable error occurred during image generation for ${poseName}.`, lastError);
    throw new Error(finalErrorMessage);
}