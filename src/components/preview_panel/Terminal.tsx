import { Terminal as TerminalIcon } from "lucide-react";

export const Terminal = () => {
    return (
        <div className="flex flex-col h-full bg-[#1e1e1e] text-white font-mono text-xs">
            <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[#333] bg-[#252526]">
                <TerminalIcon size={14} className="text-gray-400" />
                <span className="text-gray-300 font-medium">Terminal</span>
            </div>
            <div className="flex-1 p-2 overflow-auto">
                <div className="text-gray-400">
                    <span>$ </span>
                    <span className="animate-pulse">_</span>
                </div>
            </div>
        </div>
    );
};
