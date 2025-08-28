/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/
import React, { useState, ChangeEvent, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { generateReferenceImage } from './services/geminiService';
import PolaroidCard from './components/PolaroidCard';
import { createAlbumPage } from './lib/albumUtils';
import Footer from './components/Footer';
import { REFERENCE_TYPES } from './assets/poses';

// Pre-defined positions for a scattered look on desktop, updated for 2 images
const POSITIONS = [
    { top: '15%', left: '15%', rotate: -8 },
    { top: '25%', left: '55%', rotate: 5 },
];

const GHOST_POLAROIDS_CONFIG = [
  { initial: { x: "-150%", y: "-100%", rotate: -30 }, transition: { delay: 0.2 } },
  { initial: { x: "150%", y: "-80%", rotate: 25 }, transition: { delay: 0.4 } },
  { initial: { x: "-120%", y: "120%", rotate: 45 }, transition: { delay: 0.6 } },
  { initial: { x: "180%", y: "90%", rotate: -20 }, transition: { delay: 0.8 } },
  { initial: { x: "0%", y: "-200%", rotate: 0 }, transition: { delay: 0.5 } },
  { initial: { x: "100%", y: "150%", rotate: 10 }, transition: { delay: 0.3 } },
];


type ImageStatus = 'pending' | 'done' | 'error';
interface GeneratedImage {
    status: ImageStatus;
    url?: string;
    error?: string;
}

const primaryButtonClasses = "font-permanent-marker text-xl text-center text-black bg-yellow-400 py-3 px-8 rounded-sm transform transition-transform duration-200 hover:scale-105 hover:-rotate-2 hover:bg-yellow-300 shadow-[2px_2px_0px_2px_rgba(0,0,0,0.2)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:rotate-0 disabled:hover:bg-yellow-400";
const secondaryButtonClasses = "font-permanent-marker text-xl text-center text-white bg-white/10 backdrop-blur-sm border-2 border-white/80 py-3 px-8 rounded-sm transform transition-transform duration-200 hover:scale-105 hover:rotate-2 hover:bg-white hover:text-black";

const useMediaQuery = (query: string) => {
    const [matches, setMatches] = useState(false);
    useEffect(() => {
        const media = window.matchMedia(query);
        if (media.matches !== matches) {
            setMatches(media.matches);
        }
        const listener = () => setMatches(media.matches);
        window.addEventListener('resize', listener);
        return () => window.removeEventListener('resize', listener);
    }, [matches, query]);
    return matches;
};

function App() {
    const [uploadedImage, setUploadedImage] = useState<string | null>(null);
    const [generatedImages, setGeneratedImages] = useState<Record<string, GeneratedImage>>({});
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [isDownloading, setIsDownloading] = useState<boolean>(false);
    const [appState, setAppState] = useState<'idle' | 'image-uploaded' | 'generating' | 'results-shown'>('idle');
    const dragAreaRef = useRef<HTMLDivElement>(null);
    const isMobile = useMediaQuery('(max-width: 768px)');


    const handleImageUpload = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            const reader = new FileReader();
            reader.onloadend = () => {
                setUploadedImage(reader.result as string);
                setAppState('image-uploaded');
                setGeneratedImages({}); // Clear previous results
            };
            reader.readAsDataURL(file);
        }
    };

    const handleGenerateClick = async () => {
        if (!uploadedImage) return;

        setIsLoading(true);
        setAppState('generating');

        // Set initial pending status
        const initialImages: Record<string, GeneratedImage> = {};
        REFERENCE_TYPES.forEach(refType => {
            initialImages[refType.name] = { status: 'pending' };
        });
        setGeneratedImages(initialImages);

        const portraitRefType = REFERENCE_TYPES.find(rt => rt.name === 'Portrait Sheet');
        const fullBodyRefType = REFERENCE_TYPES.find(rt => rt.name === 'Full Body Sheet');

        if (!portraitRefType || !fullBodyRefType) {
            console.error("Reference types ('Portrait Sheet', 'Full Body Sheet') are not defined correctly.");
            setIsLoading(false);
            setAppState('results-shown');
            return;
        }

        let portraitResultUrl = '';

        // --- Stage 1: Generate Portrait Sheet ---
        try {
            const resultUrl = await generateReferenceImage(uploadedImage, portraitRefType.poseImage, portraitRefType.name);
            portraitResultUrl = resultUrl;
            setGeneratedImages(prev => ({
                ...prev,
                [portraitRefType.name]: { status: 'done', url: resultUrl },
            }));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setGeneratedImages(prev => ({
                ...prev,
                [portraitRefType.name]: { status: 'error', error: errorMessage },
                // Mark dependent tasks as failed as well
                [fullBodyRefType.name]: { status: 'error', error: "Depends on Portrait Sheet, which failed." },
            }));
            console.error(`Failed to generate image for ${portraitRefType.name}:`, err);
            setIsLoading(false);
            setAppState('results-shown');
            return; // Stop execution if the first stage fails
        }

        // --- Stage 2: Generate Full Body Sheet using the result from Stage 1 ---
        try {
            const resultUrl = await generateReferenceImage(uploadedImage, fullBodyRefType.poseImage, fullBodyRefType.name, portraitResultUrl);
            setGeneratedImages(prev => ({
                ...prev,
                [fullBodyRefType.name]: { status: 'done', url: resultUrl },
            }));
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            setGeneratedImages(prev => ({
                ...prev,
                [fullBodyRefType.name]: { status: 'error', error: errorMessage },
            }));
            console.error(`Failed to generate image for ${fullBodyRefType.name}:`, err);
        }

        setIsLoading(false);
        setAppState('results-shown');
    };


    const handleRegenerate = async (refTypeName: string) => {
        if (!uploadedImage) return;

        const refType = REFERENCE_TYPES.find(rt => rt.name === refTypeName);
        if (!refType || generatedImages[refTypeName]?.status === 'pending') return;
        
        console.log(`Regenerating image for ${refTypeName}...`);

        if (refTypeName === 'Portrait Sheet') {
            // If Portrait is regenerated, the Full Body must also be regenerated to maintain consistency.
            setGeneratedImages(prev => ({
                ...prev,
                'Portrait Sheet': { status: 'pending' },
                'Full Body Sheet': { status: 'pending' },
            }));
            
            let newPortraitUrl = '';
            // Stage 1: Regenerate Portrait
            try {
                const resultUrl = await generateReferenceImage(uploadedImage, refType.poseImage, refType.name);
                newPortraitUrl = resultUrl;
                setGeneratedImages(prev => ({
                    ...prev,
                    'Portrait Sheet': { status: 'done', url: resultUrl },
                }));
            } catch (err) {
                 const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                 setGeneratedImages(prev => ({
                    ...prev,
                    'Portrait Sheet': { status: 'error', error: errorMessage },
                    'Full Body Sheet': { status: 'error', error: "Depends on Portrait Sheet, which failed." },
                 }));
                 console.error(`Failed to regenerate image for Portrait Sheet:`, err);
                 return; // Stop if portrait regeneration fails
            }
            
            // Stage 2: Regenerate Full Body with the new Portrait
            const fullBodyRefType = REFERENCE_TYPES.find(rt => rt.name === 'Full Body Sheet');
            if (fullBodyRefType) {
                try {
                    const resultUrl = await generateReferenceImage(uploadedImage, fullBodyRefType.poseImage, fullBodyRefType.name, newPortraitUrl);
                    setGeneratedImages(prev => ({
                        ...prev,
                        'Full Body Sheet': { status: 'done', url: resultUrl },
                    }));
                } catch (err) {
                    const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                    setGeneratedImages(prev => ({
                        ...prev,
                        'Full Body Sheet': { status: 'error', error: errorMessage },
                    }));
                    console.error(`Failed to regenerate image for Full Body Sheet:`, err);
                }
            }

        } else if (refTypeName === 'Full Body Sheet') {
            // Regenerate Full Body only, using the existing Portrait as a reference.
            const portraitImage = generatedImages['Portrait Sheet'];
            if (!portraitImage || portraitImage.status !== 'done' || !portraitImage.url) {
                alert("Please generate a successful 'Portrait Sheet' before regenerating the 'Full Body Sheet'.");
                return;
            }

            setGeneratedImages(prev => ({ ...prev, [refTypeName]: { status: 'pending' } }));

            try {
                const resultUrl = await generateReferenceImage(uploadedImage, refType.poseImage, refType.name, portraitImage.url);
                setGeneratedImages(prev => ({
                    ...prev,
                    [refTypeName]: { status: 'done', url: resultUrl },
                }));
            } catch (err) {
                const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
                setGeneratedImages(prev => ({
                    ...prev,
                    [refTypeName]: { status: 'error', error: errorMessage },
                }));
                console.error(`Failed to regenerate image for ${refTypeName}:`, err);
            }
        }
    };
    
    const handleReset = () => {
        setUploadedImage(null);
        setGeneratedImages({});
        setAppState('idle');
    };

    const handleDownloadIndividualImage = (refTypeName: string) => {
        const image = generatedImages[refTypeName];
        if (image?.status === 'done' && image.url) {
            const link = document.createElement('a');
            link.href = image.url;
            link.download = `character-reference-${refTypeName.toLowerCase().replace(/\s/g, '-')}.jpg`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    const handleDownloadAlbum = async () => {
        setIsDownloading(true);
        try {
            const imageData = Object.entries(generatedImages)
                .filter(([, image]) => image.status === 'done' && image.url)
                .reduce((acc, [refTypeName, image]) => {
                    acc[refTypeName] = image!.url!;
                    return acc;
                }, {} as Record<string, string>);

            if (Object.keys(imageData).length < REFERENCE_TYPES.length) {
                alert("Please wait for all images to finish generating before downloading the album.");
                return;
            }

            const albumDataUrl = await createAlbumPage(imageData);

            const link = document.createElement('a');
            link.href = albumDataUrl;
            link.download = 'character-reference-sheet.jpg';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (error) {
            console.error("Failed to create or download album:", error);
            alert("Sorry, there was an error creating your album. Please try again.");
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <main className="bg-black text-neutral-200 min-h-screen w-full flex flex-col items-center justify-center p-4 pb-24 overflow-hidden relative">
            <div className="absolute top-0 left-0 w-full h-full bg-grid-white/[0.05]"></div>
            
            <div className="z-10 flex flex-col items-center justify-center w-full h-full flex-1 min-h-0">
                <div className="text-center mb-10">
                    <h1 className="text-6xl md:text-8xl font-caveat font-bold text-neutral-100">Reference Sheet Generator</h1>
                    <p className="font-permanent-marker text-neutral-300 mt-2 text-xl tracking-wide">Generate character turnarounds from a single image.</p>
                </div>

                {appState === 'idle' && (
                     <div className="relative flex flex-col items-center justify-center w-full">
                        {GHOST_POLAROIDS_CONFIG.map((config, index) => (
                             <motion.div
                                key={index}
                                className="absolute w-80 h-[26rem] rounded-md p-4 bg-neutral-100/10 blur-sm"
                                initial={config.initial}
                                animate={{ x: "0%", y: "0%", rotate: (Math.random() - 0.5) * 20, scale: 0, opacity: 0, }}
                                transition={{ ...config.transition, ease: "circOut", duration: 2, }}
                            />
                        ))}
                        <motion.div
                             initial={{ opacity: 0, scale: 0.8 }}
                             animate={{ opacity: 1, scale: 1 }}
                             transition={{ delay: 2, duration: 0.8, type: 'spring' }}
                             className="flex flex-col items-center"
                        >
                            <label htmlFor="file-upload" className="cursor-pointer group transform hover:scale-105 transition-transform duration-300">
                                 <PolaroidCard 
                                     caption="Click to begin"
                                     status="done"
                                 />
                            </label>
                            <input id="file-upload" type="file" className="hidden" accept="image/png, image/jpeg, image/webp" onChange={handleImageUpload} />
                            <p className="mt-8 font-permanent-marker text-neutral-500 text-center max-w-xs text-lg">
                                Click the polaroid to upload a square image of your character.
                            </p>
                        </motion.div>
                    </div>
                )}

                {appState === 'image-uploaded' && uploadedImage && (
                    <div className="flex flex-col items-center gap-6">
                        <PolaroidCard 
                            imageUrl={uploadedImage} 
                            caption="Your Character" 
                            status="done"
                        />
                         <div className="flex items-center gap-4">
                            <button onClick={handleReset} className={secondaryButtonClasses}>
                                Start Over
                            </button>
                            <button onClick={handleGenerateClick} className={primaryButtonClasses}>
                                Generate
                            </button>
                         </div>
                    </div>
                )}

                {(appState === 'generating' || appState === 'results-shown') && (
                     <>
                        {isMobile ? (
                            <div className="w-full max-w-sm flex-1 overflow-y-auto mt-4 space-y-8 p-4">
                                {REFERENCE_TYPES.map((refType) => (
                                    <div key={refType.name} className="flex justify-center">
                                         <PolaroidCard
                                            caption={refType.name}
                                            status={generatedImages[refType.name]?.status || 'pending'}
                                            imageUrl={generatedImages[refType.name]?.url}
                                            error={generatedImages[refType.name]?.error}
                                            onShake={() => handleRegenerate(refType.name)}
                                            onDownload={() => handleDownloadIndividualImage(refType.name)}
                                            isMobile={isMobile}
                                        />
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div ref={dragAreaRef} className="relative w-full max-w-5xl h-[600px] mt-4">
                                {REFERENCE_TYPES.map((refType, index) => {
                                    const { top, left, rotate } = POSITIONS[index % POSITIONS.length];
                                    return (
                                        <motion.div
                                            key={refType.name}
                                            className="absolute cursor-grab active:cursor-grabbing"
                                            style={{ top, left }}
                                            initial={{ opacity: 0, scale: 0.5, y: 100, rotate: 0 }}
                                            animate={{ opacity: 1, scale: 1, y: 0, rotate: `${rotate}deg`, }}
                                            transition={{ type: 'spring', stiffness: 100, damping: 20, delay: index * 0.15 }}
                                        >
                                            <PolaroidCard 
                                                dragConstraintsRef={dragAreaRef}
                                                caption={refType.name}
                                                status={generatedImages[refType.name]?.status || 'pending'}
                                                imageUrl={generatedImages[refType.name]?.url}
                                                error={generatedImages[refType.name]?.error}
                                                onShake={() => handleRegenerate(refType.name)}
                                                onDownload={() => handleDownloadIndividualImage(refType.name)}
                                                isMobile={isMobile}
                                            />
                                        </motion.div>
                                    );
                                })}
                            </div>
                        )}
                         <div className="h-20 mt-4 flex items-center justify-center">
                            {appState === 'results-shown' && (
                                <div className="flex flex-col sm:flex-row items-center gap-4">
                                    <button 
                                        onClick={handleDownloadAlbum} 
                                        disabled={isDownloading || Object.values(generatedImages).some(img => img.status !== 'done')} 
                                        className={`${primaryButtonClasses}`}
                                    >
                                        {isDownloading ? 'Creating Sheet...' : 'Download Sheet'}
                                    </button>
                                    <button onClick={handleReset} className={secondaryButtonClasses}>
                                        Start Over
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </div>
            <Footer />
        </main>
    );
}

export default App;