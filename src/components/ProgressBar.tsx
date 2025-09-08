import React from 'react';
import { LoadingProgress } from '../types';

interface ProgressBarProps {
  progress: LoadingProgress;
  loading: boolean;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, loading }) => {
  // Progress bar is now integrated into the package info div
  return null;
};