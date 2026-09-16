'use client';
import { FacePhotoEditor } from '@/components/face-photo-editor';
export function PhotoUpload({ initialPhotoUrl }: { initialPhotoUrl: string | null }) {
  return <div className="photo-block"><FacePhotoEditor key={initialPhotoUrl || 'no-photo'} endpoint="/api/client/photo" initialPhotoUrl={initialPhotoUrl}/></div>;
}
