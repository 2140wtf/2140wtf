import type { ComponentType, CSSProperties } from 'react';
import {
  AlertCircle,
  AlertOctagon,
  AlertTriangle,
  Ban,
  Camera,
  Car,
  CloudFog,
  Info,
  PawPrint,
  Route,
  Shield,
  Snowflake,
  TrafficCone,
} from 'lucide-react';

export type RoadstrEventType =
  | 'police'
  | 'speed_camera'
  | 'traffic_jam'
  | 'accident'
  | 'road_closure'
  | 'construction'
  | 'hazard'
  | 'road_condition'
  | 'pothole'
  | 'fog'
  | 'ice'
  | 'animal'
  | 'other';

export const ROADSTR_EVENT_TYPE_VALUES: RoadstrEventType[] = [
  'police',
  'speed_camera',
  'traffic_jam',
  'accident',
  'road_closure',
  'construction',
  'hazard',
  'road_condition',
  'pothole',
  'fog',
  'ice',
  'animal',
  'other',
];

export interface RoadstrTypeConfig {
  label: string;
  /** Default effective TTL in seconds. */
  ttlSeconds: number;
  /** Marker color (hex). */
  color: string;
  /** Lucide icon component. */
  icon: ComponentType<{ className?: string; style?: CSSProperties }>;
}

export const ROADSTR_EVENT_TYPES: Record<RoadstrEventType, RoadstrTypeConfig> = {
  police: { label: 'Police', ttlSeconds: 2 * 60 * 60, color: '#2196F3', icon: Shield },
  speed_camera: { label: 'Speed camera', ttlSeconds: 30 * 24 * 60 * 60, color: '#800080', icon: Camera },
  traffic_jam: { label: 'Traffic jam', ttlSeconds: 60 * 60, color: '#FF8C00', icon: Car },
  accident: { label: 'Accident', ttlSeconds: 3 * 60 * 60, color: '#FF0000', icon: AlertOctagon },
  road_closure: { label: 'Road closure', ttlSeconds: 7 * 24 * 60 * 60, color: '#424242', icon: Ban },
  construction: { label: 'Construction', ttlSeconds: 7 * 24 * 60 * 60, color: '#FF9800', icon: TrafficCone },
  hazard: { label: 'Hazard', ttlSeconds: 4 * 60 * 60, color: '#FFC107', icon: AlertTriangle },
  road_condition: { label: 'Road condition', ttlSeconds: 6 * 60 * 60, color: '#4682B4', icon: Route },
  pothole: { label: 'Pothole', ttlSeconds: 7 * 24 * 60 * 60, color: '#795548', icon: AlertCircle },
  fog: { label: 'Fog', ttlSeconds: 3 * 60 * 60, color: '#9E9E9E', icon: CloudFog },
  ice: { label: 'Ice', ttlSeconds: 6 * 60 * 60, color: '#00CED1', icon: Snowflake },
  animal: { label: 'Animal', ttlSeconds: 60 * 60, color: '#4CAF50', icon: PawPrint },
  other: { label: 'Other', ttlSeconds: 2 * 60 * 60, color: '#9E9E9E', icon: Info },
};

export function isRoadstrEventType(value: string): value is RoadstrEventType {
  return ROADSTR_EVENT_TYPE_VALUES.includes(value as RoadstrEventType);
}
