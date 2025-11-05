import React from 'react';
import { DownloadIcon } from './Icons';
import { ProcessState } from '../types';

interface VideoPreviewProps {
  videoUrl: string | null;
  processState: ProcessState;
  generationProgress: { current: number; total: number };
  renderProgress: number;
}

const VideoPreview: React.FC<VideoPreviewProps> = ({ videoUrl, processState, generationProgress, renderProgress }) => {

  const StatusDisplay: React.FC = () => {
    switch (processState) {
      case 'analyzing':
        return <p className="text-lg text-cyan-400">Đang phân tích kịch bản...</p>;
      
      case 'generating_images':
        return (
          <div className="w-full max-w-sm px-4 text-center">
            <p className="text-lg mb-2 text-cyan-400">Đang tạo hình ảnh...</p>
            <p className="text-2xl font-bold">{generationProgress.current} / {generationProgress.total}</p>
          </div>
        );

      case 'rendering':
        return (
          <div className="w-full max-w-sm px-4 text-center">
            <p className="text-lg mb-2 text-cyan-400">Đang xử lý video của bạn...</p>
            <div className="w-full bg-slate-700 rounded-full h-2.5">
              <div
                className="bg-cyan-500 h-2.5 rounded-full transition-all duration-150"
                style={{ width: `${renderProgress}%` }}
              ></div>
            </div>
            <p className="text-sm text-slate-400 mt-2">{Math.round(renderProgress)}%</p>
          </div>
        );

      case 'done':
        if (videoUrl) {
          return <video src={videoUrl} controls className="w-full h-full object-contain"></video>;
        }
        return <p>Đã xảy ra lỗi khi hiển thị video.</p>;

      case 'idle':
      case 'error':
      default:
        return (
          <div className="text-slate-500 text-center">
            <p className="text-lg">Video của bạn sẽ xuất hiện ở đây</p>
            <p className="text-sm">Điền kịch bản và nhấn "Tạo Video" để bắt đầu</p>
          </div>
        );
    }
  };

  return (
    <div className="flex flex-col items-center justify-between h-full">
      <h2 className="text-2xl font-semibold text-slate-100 mb-4 self-start">2. Xem trước & Kết quả</h2>
      
      <div className="w-full aspect-video bg-slate-900/70 rounded-lg flex items-center justify-center mb-4 overflow-hidden border border-slate-700">
        <StatusDisplay />
      </div>

      <div className="w-full">
        {processState === 'done' && videoUrl && (
          <a
            href={videoUrl}
            download="video-tao-tu-ai.mp4"
            className="flex w-full items-center justify-center gap-2 bg-green-600 hover:bg-green-500 text-white font-bold py-3 px-4 rounded-lg transition-transform transform hover:scale-105"
          >
            <DownloadIcon className="w-5 h-5"/>
            Tải về Video
          </a>
        )}
      </div>
    </div>
  );
};

export default VideoPreview;