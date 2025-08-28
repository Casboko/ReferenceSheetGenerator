/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// --- Type Definitions ---

export type PoseName =
  | "Portrait Sheet"
  | "Full Body Sheet";


// --- Pose-Specific Prompts ---

const PORTRAIT_PROMPT = `Using the first image as the character reference and the second image for poses, generate a single image showing the character's head from all angles depicted in the second image. Perfectly maintain the style, tone, character features, and clothing from the first image. Arrange the generated views neatly on a single, plain white background.`;

// This prompt is used for the standard, single-stage generation.
const FULL_BODY_PROMPT_SINGLE = `Using the first image as the character reference and the second image for poses, generate a single image showing the character in all the full-body poses depicted in the second image. Perfectly maintain the style, tone, character features, and clothing from the first image. Arrange the generated views neatly on a single, plain white background.`;

// This new prompt is specifically for the 2-stage (chained) generation process, where three images are provided.
const FULL_BODY_PROMPT_CHAINED = `Use the first image (Original Character) and second image (Generated Portraits) as the primary character references. Use the third image (Pose Reference) for the poses. Recreate the character from the first two images in all the exact full-body poses shown in the third image. It is crucial to preserve all character features, styling, and clothing with perfect consistency. The final output must be a single image containing all recreated poses, set against a plain white background.`;

const FALLBACK_PROMPT = `Use the first image (Character Reference) as the character design. Use the subsequent images (Pose References) for poses and framing. Recreate the character from the first image in all the exact poses shown in the reference images. Preserve all character features, styling, and clothing. The final output must be a single image containing all recreated poses, set against a plain white background.`;


// --- Prompt Generation Function ---

/**
 * Generates the final prompt string. It selects the correct prompt based on the pose name
 * and whether it's part of a chained generation process (i.e., has an additional reference image).
 * @param poseName - The name of the pose.
 * @param isChained - True if an additional reference image is being used.
 * @returns The fully constructed prompt string for the specified pose.
 */
export function generatePrompt(poseName: PoseName | string, isChained: boolean = false): string {
    if (poseName === 'Portrait Sheet') {
        return PORTRAIT_PROMPT;
    }
    if (poseName === 'Full Body Sheet') {
        // Use the specific chained prompt if it's a 2-stage call, otherwise use the standard one.
        return isChained ? FULL_BODY_PROMPT_CHAINED : FULL_BODY_PROMPT_SINGLE;
    }
    return FALLBACK_PROMPT;
}