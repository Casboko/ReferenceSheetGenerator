/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

// This file defines the different reference poses.
// Instead of individual poses, we now use composite images containing multiple views.
// The leading '/' makes them absolute paths from the root of the site,
// ensuring they can be fetched correctly by the application.

const POSE_PORTRAIT_SHEET = '/assets/Face.png';
const POSE_FULL_BODY_SHEET = '/assets/fullbody.png';

export const REFERENCE_TYPES = [
    { name: 'Portrait Sheet', poseImage: POSE_PORTRAIT_SHEET },
    { name: 'Full Body Sheet', poseImage: POSE_FULL_BODY_SHEET },
];