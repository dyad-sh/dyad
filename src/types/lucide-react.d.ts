declare module 'lucide-react' {
    import { FC, SVGProps } from 'react';
    export interface IconProps extends SVGProps<SVGSVGElement> {
        size?: number | string;
        absoluteStrokeWidth?: boolean;
    }
    export type Icon = FC<IconProps>;
    export const ArrowLeft: Icon;
    export const ArrowRight: Icon;
    export const RefreshCw: Icon;
    export const ExternalLink: Icon;
    export const Loader2: Icon;
    export const X: Icon;
    export const Sparkles: Icon;
    export const ChevronDown: Icon;
    export const Lightbulb: Icon;
    export const ChevronRight: Icon;
    export const MousePointerClick: Icon;
    export const Power: Icon;
    export const MonitorSmartphone: Icon;
    export const Monitor: Icon;
    export const Tablet: Icon;
    export const Smartphone: Icon;
    export const Terminal: Icon;
    // Add other icons as needed or use a generic export if preferred
    export const icons: Record<string, Icon>;
}
