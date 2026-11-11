import { api } from '../api.js';
import AuthImage from './AuthImage.jsx';
import VideoPoster from './VideoPoster.jsx';

export default function AlbumCover({ file }) {
  const placeholder = <div className="album-card-cover-placeholder" />;
  if (!file) return placeholder;
  if (file.kind === 'video') return <VideoPoster file={file} decorative />;
  return file.kind === 'image' ? <AuthImage src={api.thumbnailUrl(file.id)} alt="" className="album-card-cover-img" placeholder={placeholder} /> : placeholder;
}
