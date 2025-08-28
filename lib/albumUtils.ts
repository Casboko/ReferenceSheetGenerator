/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
// Helper function to load an image and return it as an HTMLImageElement
function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        // Setting crossOrigin is good practice for canvas operations, even with data URLs
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(new Error(`Failed to load image: ${src.substring(0, 50)}...`));
        img.src = src;
    });
}

/**
 * Creates a single "photo album" page image from a collection of decade images.
 * @param imageData A record mapping decade strings to their image data URLs.
 * @returns A promise that resolves to a data URL of the generated album page (JPEG format).
 */
export async function createAlbumPage(imageData: Record<string, string>): Promise<string> {
    const canvas = document.createElement('canvas');
    // High-resolution canvas for good quality (A4-like ratio)
    const canvasWidth = 2480;
    const canvasHeight = 3508;
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    
    const ctx = canvas.getContext('2d');
    if (!ctx) {
        throw new Error('Could not get 2D canvas context');
    }

    // 1. Draw the album page background
    ctx.fillStyle = '#f0f0f0'; // A neutral light gray background
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);

    // 2. Draw the title
    ctx.fillStyle = '#333';
    ctx.textAlign = 'center';

    ctx.font = `bold 100px 'Caveat', cursive`;
    ctx.fillText('Character Reference Sheet', canvasWidth / 2, 150);

    ctx.font = `50px 'Roboto', sans-serif`;
    ctx.fillStyle = '#555';
    ctx.fillText('Generated with Google AI Studio', canvasWidth / 2, 220);

    // 3. Load all the polaroid images concurrently
    const refTypes = Object.keys(imageData);
    const loadedImages = await Promise.all(
        Object.values(imageData).map(url => loadImage(url))
    );

    const imagesWithRefTypes = refTypes.map((refType, index) => ({
        refType,
        img: loadedImages[index],
    }));

    // 4. Define grid layout (1 col, 2 rows) and draw each composite image
    const grid = { cols: 1, rows: 2, padding: 120 };
    const contentTopMargin = 300; // Space for the header
    const contentHeight = canvasHeight - contentTopMargin - grid.padding;
    const cellWidth = canvasWidth - grid.padding * 2;
    const cellHeight = (contentHeight - grid.padding * (grid.rows + 1)) / grid.rows;

    imagesWithRefTypes.forEach(({ refType, img }, index) => {
        const row = index;
        const col = 0;

        const x = grid.padding;
        const y = contentTopMargin + grid.padding * (row + 1) + cellHeight * row;
        
        ctx.save();
        
        ctx.translate(x + cellWidth / 2, y + cellHeight / 2);
        
        const rotation = (Math.random() - 0.5) * 0.05; // Radians (approx. +/- 1.4 degrees)
        ctx.rotate(rotation);
        
        ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
        ctx.shadowBlur = 40;
        ctx.shadowOffsetX = 5;
        ctx.shadowOffsetY = 10;
        
        // Calculate image dimensions to fit while maintaining aspect ratio
        const aspectRatio = img.naturalWidth / img.naturalHeight;
        let drawWidth = cellWidth * 0.95;
        let drawHeight = drawWidth / aspectRatio;

        if (drawHeight > cellHeight * 0.95) {
            drawHeight = cellHeight * 0.95;
            drawWidth = drawHeight * aspectRatio;
        }
        
        const imgX = -drawWidth / 2;
        const imgY = -drawHeight / 2;
        
        ctx.drawImage(img, imgX, imgY, drawWidth, drawHeight);
        
        ctx.shadowColor = 'transparent';

        // Draw the caption below the image
        ctx.fillStyle = '#222';
        ctx.font = `60px 'Permanent Marker', cursive`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(refType, 0, imgY + drawHeight + 25);
        
        ctx.restore();
    });

    return canvas.toDataURL('image/jpeg', 0.9);
}