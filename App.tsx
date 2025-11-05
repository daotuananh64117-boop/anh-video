import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI, Type, Modality, GenerateContentResponse } from '@google/genai';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

import { Scene, TransitionType, ProcessState } from './types';
import VideoPreview from './components/VideoPreview';
import { db } from './db';

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const App: React.FC = () => {
  const [prompt, setPrompt] = useState('');
  const [totalMinutes, setTotalMinutes] = useState('0');
  const [totalSeconds, setTotalSeconds] = useState('30');
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [processState, setProcessState] = useState<ProcessState>('idle');
  const [generationProgress, setGenerationProgress] = useState({ current: 0, total: 0 });
  const [renderProgress, setRenderProgress] = useState(0);

  const ffmpegRef = useRef(new FFmpeg());
  const [ffmpegLoaded, setFfmpegLoaded] = useState(false);

  useEffect(() => {
    const loadFfmpeg = async () => {
      const ffmpeg = ffmpegRef.current;
      ffmpeg.on('log', ({ message }) => {
        // console.log(message); // For debugging ffmpeg
      });
      ffmpeg.on('progress', ({ progress }) => {
        setRenderProgress(Math.round(progress * 100));
      });
      const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      });
      setFfmpegLoaded(true);
    };
    loadFfmpeg();
  }, []);
  
  const startVideoCreation = useCallback(async () => {
    const totalDurationInSeconds = (parseInt(totalMinutes, 10) || 0) * 60 + (parseInt(totalSeconds, 10) || 0);
    if (totalDurationInSeconds <= 0) {
        setError('Tổng thời lượng phải lớn hơn 0 giây.');
        return;
    }

    setProcessState('analyzing');
    setError(null);
    setVideoUrl(null);
    setScenes([]);
    setGenerationProgress({ current: 0, total: 0 });
    setRenderProgress(0);
    await db.clear();

    try {
      // 1. Analyze script
      const systemInstruction = `You are a script-parsing assistant for a video generator.
The user will provide a script and a total video duration. Your task is to parse this script and convert it into a structured JSON array of scenes.
The total duration of the video must be exactly ${totalDurationInSeconds} seconds. You must distribute this total duration among the scenes you create, based on the script's content. The sum of all scene durations must equal the total duration.
For each scene described in the script, you must extract or generate the following:
- "description": A short summary of the scene in Vietnamese, based on the script.
- "imagePrompt": A detailed, descriptive prompt in English for an AI image generator to create the visual for the scene. This should be based on the scene's description.
- "duration": The duration for this specific scene in seconds. The sum of all durations must be ${totalDurationInSeconds}.
- "transition": A transition effect to the next scene. Use "Fade" for the last scene. For others, you can choose from the available options.
The output must be a valid JSON array of scenes.`;
      
      const response = await ai.models.generateContent({
        model: "gemini-2.5-pro",
        contents: [{ role: 'user', parts: [{text: prompt}] }],
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                description: { type: Type.STRING },
                imagePrompt: { type: Type.STRING },
                duration: { type: Type.NUMBER },
                transition: {
                  type: Type.STRING,
                  enum: Object.values(TransitionType)
                },
              },
              required: ["description", "imagePrompt", "duration", "transition"]
            },
          },
        },
      });

      const responseText = response.text;
      const parsedScenes = JSON.parse(responseText);
      const initialScenes: Scene[] = parsedScenes.map((scene: any) => ({
        ...scene,
        id: crypto.randomUUID(),
        imageDataUrl: null,
      }));

      if (initialScenes.length === 0) {
        throw new Error("Kịch bản không tạo ra được cảnh nào. Vui lòng thử lại với kịch bản chi tiết hơn.");
      }

      // 2. Generate Images
      setProcessState('generating_images');
      setGenerationProgress({ current: 0, total: initialScenes.length });

      const imageGenerationPromises = initialScenes.map(scene => generateImageForScene(scene.imagePrompt));
      const generatedImageUrls = await Promise.all(imageGenerationPromises);
      
      const completeScenes: Scene[] = initialScenes.map((scene, index) => ({
        ...scene,
        imageDataUrl: generatedImageUrls[index],
      }));

      if (completeScenes.some(s => !s.imageDataUrl)) {
        throw new Error("Một hoặc nhiều hình ảnh không thể được tạo. Vui lòng thử lại.");
      }
      
      setScenes(completeScenes);
      await db.bulkPut(completeScenes);

      // 3. Render Video
      setProcessState('rendering');
      const finalVideoUrl = await renderVideo(completeScenes);
      setVideoUrl(finalVideoUrl);
      setProcessState('done');

    } catch (e: any) {
      console.error(e);
      setError(e.message || 'Đã xảy ra lỗi trong quá trình tạo video.');
      setProcessState('error');
    }
  }, [prompt, totalMinutes, totalSeconds]);
  
  const generateImageForScene = async (imagePrompt: string): Promise<string | null> => {
    try {
      const response: GenerateContentResponse = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ text: imagePrompt }] },
        config: {
            responseModalities: [Modality.IMAGE],
        },
      });
      
      for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
          const base64ImageBytes: string = part.inlineData.data;
          const imageUrl = `data:${part.inlineData.mimeType};base64,${base64ImageBytes}`;
          setGenerationProgress(prev => ({ ...prev, current: prev.current + 1 }));
          return imageUrl;
        }
      }
      throw new Error("No image data in API response");
    } catch (e) {
      console.error(`Failed to generate image for prompt "${imagePrompt}":`, e);
      setGenerationProgress(prev => ({ ...prev, current: prev.current + 1 }));
      return null;
    }
  };

  const renderVideo = async (scenesToRender: Scene[]): Promise<string> => {
    if (scenesToRender.length === 0 || !ffmpegLoaded) {
      throw new Error("Không có cảnh nào để tạo video hoặc ffmpeg chưa sẵn sàng.");
    }
    const ffmpeg = ffmpegRef.current;

    for (let i = 0; i < scenesToRender.length; i++) {
      const scene = scenesToRender[i];
      const res = await fetch(scene.imageDataUrl!);
      const buf = await res.arrayBuffer();
      await ffmpeg.writeFile(`img${i}.jpg`, new Uint8Array(buf));
    }

    const inputs: string[] = [];
    scenesToRender.forEach((s, i) => {
        inputs.push('-loop', '1', '-t', String(s.duration), '-i', `img${i}.jpg`);
    });

    let filter_complex = '';
    if (scenesToRender.length > 1) {
      let last_stream = '[0:v]';
      let cumulative_duration = 0;
      for (let i = 0; i < scenesToRender.length - 1; i++) {
          cumulative_duration += scenesToRender[i].duration;
          const next_stream = `[${i + 1}:v]`;
          const output_stream = `[v${i + 1}]`;
          const offset = cumulative_duration - 1; 
          filter_complex += `${last_stream}${next_stream}xfade=transition=fade:duration=1:offset=${offset}${output_stream};`;
          last_stream = output_stream;
      }
      filter_complex += `${last_stream}format=yuv420p`;
    } else {
      filter_complex = `[0:v]format=yuv420p`;
    }
    
    const total_duration = scenesToRender.reduce((sum, scene) => sum + scene.duration, 0);

    const command = [
        ...inputs,
        '-filter_complex',
        filter_complex,
        '-t',
        String(total_duration),
        '-movflags',
        '+faststart',
        '-y',
        'output.mp4',
    ];

    await ffmpeg.exec(command);
    
    const data = await ffmpeg.readFile('output.mp4');
    const url = URL.createObjectURL(new Blob([(data as Uint8Array).buffer], { type: 'video/mp4' }));
    return url;
  };
  
  useEffect(() => {
    const isReadyForNewJob = processState === 'idle' || processState === 'done' || processState === 'error';

    if (!isReadyForNewJob || !prompt.trim() || !ffmpegLoaded) {
      return;
    }

    const timer = setTimeout(() => {
        startVideoCreation();
    }, 2000); // Debounce time: 2 seconds

    return () => clearTimeout(timer);
  }, [prompt, totalMinutes, totalSeconds, ffmpegLoaded, processState, startVideoCreation]);
  
  const isProcessing = !['idle', 'done', 'error'].includes(processState);

  return (
    <div className="bg-slate-900 text-white min-h-screen font-sans">
      <header className="bg-slate-800/50 backdrop-blur-sm p-4 border-b border-slate-700">
        <h1 className="text-3xl font-bold text-center text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-cyan-400">
          Trình tạo Video AI
        </h1>
      </header>
      <main className="p-4 sm:p-8 max-w-4xl mx-auto flex flex-col gap-8">
        
        <div className="bg-slate-800/50 p-6 rounded-lg border border-slate-700">
          <h2 className="text-2xl font-semibold text-slate-100 mb-4">1. Kịch bản của bạn</h2>
          <p className="text-sm text-slate-400 mb-4">Dán kịch bản của bạn vào ô bên dưới. Video sẽ được tự động tạo sau khi bạn nhập xong.</p>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Ví dụ:
Cảnh 1 (5 giây): Một phi hành gia mèo đang bay trong không gian giữa các vì sao lấp lánh.
Cảnh 2 (8 giây): Cận cảnh chú mèo đáp xuống một hành tinh làm bằng bánh rán phủ sô cô la."
            className="w-full h-36 bg-slate-900 border border-slate-600 rounded-md p-3 focus:ring-2 focus:ring-cyan-500 focus:outline-none transition"
            disabled={isProcessing}
          />
           <div className="flex items-center gap-4 mt-4">
              <label htmlFor="total-duration" className="text-slate-300 font-medium whitespace-nowrap">Tổng thời lượng:</label>
              <div className="flex items-center gap-2 w-full">
                  <input
                      type="number"
                      id="total-minutes"
                      value={totalMinutes}
                      onChange={(e) => setTotalMinutes(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
                      min="0"
                      aria-label="Phút"
                      disabled={isProcessing}
                  />
                  <span className="text-slate-400">phút</span>
                  <input
                      type="number"
                      id="total-seconds"
                      value={totalSeconds}
                      onChange={(e) => setTotalSeconds(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded-md p-2 focus:ring-2 focus:ring-cyan-500 focus:outline-none"
                      min="0"
                      max="59"
                      step="1"
                      aria-label="Giây"
                      disabled={isProcessing}
                  />
                  <span className="text-slate-400">giây</span>
              </div>
          </div>
          {!ffmpegLoaded && <p className="text-xs text-center mt-4 text-slate-500">Đang tải tài nguyên dựng video...</p>}
        </div>
        
        <div className="bg-slate-800/50 p-6 rounded-lg border border-slate-700">
          <VideoPreview
            videoUrl={videoUrl}
            processState={processState}
            generationProgress={generationProgress}
            renderProgress={renderProgress}
          />
        </div>
        
        {error && (
          <div className="fixed bottom-4 right-4 bg-red-800 text-white p-4 rounded-lg shadow-lg animate-fade-in">
            <p className="font-semibold">Đã xảy ra lỗi</p>
            <p className="text-sm">{error}</p>
            <button onClick={() => setError(null)} className="absolute top-1 right-2 font-bold">x</button>
          </div>
        )}
      </main>
    </div>
  );
};

export default App;