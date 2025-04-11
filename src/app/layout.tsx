import { SidebarProvider } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider } from "../contexts/ThemeContext";
import { Toaster } from "sonner";
import { TitleBar } from "./TitleBar";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <TitleBar />
      <ThemeProvider>
        <SidebarProvider>
          <AppSidebar />
          <div className="flex h-screenish w-full overflow-x-hidden mt-8 mb-4 mr-4 border-t border-l border-border rounded-lg bg-background">
            {children}
          </div>
          <Toaster richColors />
        </SidebarProvider>
      </ThemeProvider>
    </>
  );
}
