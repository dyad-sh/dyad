import { Images } from "lucide-react";

import { PageContainer } from "@/components/PageContainer";
import { ParticleBackground } from "@/components/home/ParticleBackground";
import { StockImageGallery } from "@/components/library/StockImageGallery";

/** The gallery on its own route. The Library's Stock tab shows the same one. */
export default function StockImagesPage() {
  return (
    <div className="home-jarvis relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <ParticleBackground className="z-0" />
      <div
        className="relative z-10 flex min-h-0 flex-1 flex-col overflow-x-hidden overflow-y-auto"
        data-reset-scroll-on-route
      >
        <PageContainer size="xl" className="py-6">
          <div className="mb-6">
            <h1 className="flex items-center gap-2 text-3xl font-bold">
              <Images className="h-8 w-8" />
              Stock Images
            </h1>
            <p className="text-muted-foreground mt-1 text-sm">
              Search Pixabay and save what you find into your Library, where the
              assistant can use it.
            </p>
          </div>

          <StockImageGallery />
        </PageContainer>
      </div>
    </div>
  );
}
