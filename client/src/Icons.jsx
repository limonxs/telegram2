import React from 'react';
import { 
  Play, Pause, VolumeX, Volume2, Headphones, Camera, Image as LucideImage, Palette, Eraser, 
  Film, MonitorUp, Maximize, Minimize, Search, X, Settings, Phone, User, Users, Moon, 
  LogOut, Pin, Folder, Paperclip, Send, Music, Hourglass, AlertCircle, Gamepad2, Bell, 
  Eye, Globe, MessageSquare, Video, Signal, CircleDot, Mic, Dices, Grid, Pencil, Trash2, Heart
} from 'lucide-react';

const wrapIcon = (LucideIcon) => {
  return ({ size = 20, color = 'currentColor', className = '', ...props }) => (
    <LucideIcon 
      size={size} 
      color={color} 
      className={`ui-icon ${className}`} 
      strokeWidth={2}
      {...props} 
    />
  );
};

export const PlayIcon = wrapIcon(Play);
export const PauseIcon = wrapIcon(Pause);
export const MuteIcon = wrapIcon(VolumeX);
export const UnmuteIcon = wrapIcon(Volume2);
export const DeafenedIcon = wrapIcon(Headphones);
export const CameraIcon = wrapIcon(Camera);
export const ImageIcon = wrapIcon(LucideImage);
export const PaintIcon = wrapIcon(Palette);
export const EraserIcon = wrapIcon(Eraser);
export const GiphyIcon = wrapIcon(Film);
export const ScreenShareIcon = wrapIcon(MonitorUp);
export const FullscreenIcon = wrapIcon(Maximize);
export const MinimizeIcon = wrapIcon(Minimize);
export const SearchIcon = wrapIcon(Search);
export const CloseIcon = wrapIcon(X);
export const SettingsIcon = wrapIcon(Settings);
export const PhoneIcon = wrapIcon(Phone);
export const ProfileIcon = wrapIcon(User);
export const GroupIcon = wrapIcon(Users);
export const MoonIcon = wrapIcon(Moon);
export const DoorIcon = wrapIcon(LogOut);
export const PinIcon = wrapIcon(Pin);
export const FolderIcon = wrapIcon(Folder);
export const AttachIcon = wrapIcon(Paperclip);
export const SendIcon = wrapIcon(Send);
export const MusicIcon = wrapIcon(Music);
export const HourglassIcon = wrapIcon(Hourglass);
export const AlertIcon = wrapIcon(AlertCircle);
export const GamingIcon = wrapIcon(Gamepad2);
export const BellIcon = wrapIcon(Bell);
export const EyeIcon = wrapIcon(Eye);
export const GlobeIcon = wrapIcon(Globe);
export const MessageIcon = wrapIcon(MessageSquare);
export const VideoIcon = wrapIcon(Video);
export const SignalIcon = wrapIcon(Signal);
export const RecordIcon = wrapIcon(CircleDot);
export const MicIcon = wrapIcon(Mic);
export const ChessIcon = wrapIcon(Dices);
export const VoiceActiveIcon = wrapIcon(Volume2);
export const GridIcon = wrapIcon(Grid);
export const HeartIcon = wrapIcon(Heart);
export const EditIcon = ({ size = 20, color = 'currentColor', className = '', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
    <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path>
  </svg>
);

export const TrashIcon = ({ size = 20, color = 'currentColor', className = '', ...props }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} {...props}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
  </svg>
);
