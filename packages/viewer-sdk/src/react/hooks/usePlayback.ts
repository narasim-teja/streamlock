/**
 * usePlayback hook
 */

import { useState, useCallback, useEffect, useRef } from 'react';

/** Playback state */
export interface UsePlaybackState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  currentSegment: number;
  buffered: number;
}

/** Playback actions */
export interface UsePlaybackActions {
  play: () => void;
  pause: () => void;
  seek: (time: number) => void;
  setVideoElement: (element: HTMLVideoElement | null) => void;
}

/** usePlayback hook */
export function usePlayback(
  segmentDuration: number = 5
): [UsePlaybackState, UsePlaybackActions] {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);

  const currentSegment = Math.floor(currentTime / segmentDuration);

  // Set up event listeners
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleTimeUpdate = () => setCurrentTime(video.currentTime);
    const handleDurationChange = () => setDuration(video.duration);
    const handleProgress = () => {
      if (video.buffered.length > 0) {
        setBuffered(video.buffered.end(video.buffered.length - 1));
      }
    };

    video.addEventListener('play', handlePlay);
    video.addEventListener('pause', handlePause);
    video.addEventListener('timeupdate', handleTimeUpdate);
    video.addEventListener('durationchange', handleDurationChange);
    video.addEventListener('progress', handleProgress);

    return () => {
      video.removeEventListener('play', handlePlay);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('timeupdate', handleTimeUpdate);
      video.removeEventListener('durationchange', handleDurationChange);
      video.removeEventListener('progress', handleProgress);
    };
  }, []);

  const play = useCallback(() => {
    videoRef.current?.play();
  }, []);

  const pause = useCallback(() => {
    videoRef.current?.pause();
  }, []);

  const seek = useCallback((time: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  }, []);

  const setVideoElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
  }, []);

  const state: UsePlaybackState = {
    isPlaying,
    currentTime,
    duration,
    currentSegment,
    buffered,
  };

  const actions: UsePlaybackActions = {
    play,
    pause,
    seek,
    setVideoElement,
  };

  return [state, actions];
}
