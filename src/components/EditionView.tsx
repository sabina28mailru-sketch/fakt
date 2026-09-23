"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Clapperboard, GalleryHorizontalEnd, LayoutGrid } from "lucide-react";
import { useState } from "react";
import type { Edition } from "@/lib/schema";
import { BackupTopics } from "./BackupTopics";
import { CarouselView } from "./CarouselView";
import { EditionHeader } from "./EditionHeader";
import { ExpertLens } from "./ExpertLens";
import { FactsTable } from "./FactsTable";
import { EASE } from "./motion";
import { ReelView } from "./ReelView";
import { StoriesView } from "./StoriesView";
import { Segmented } from "./ui/Segmented";

type Format = "stories" | "carousel" | "reel";

export function EditionView({
  edition,
  isToday,
}: {
  edition: Edition;
  isToday: boolean;
}) {
  const [format, setFormat] = useState<Format>("stories");
  const reduce = useReducedMotion();

  return (
    <div className="flex flex-col gap-10 lg:gap-14">
      <EditionHeader edition={edition} isToday={isToday} />

      <div className="flex flex-col gap-6">
        {/* Вкладки липнут под мастхедом, пока нет правой колонки-оглавления (≥1280). */}
        <div className="sticky top-[var(--bar-top)] z-20 bg-bg xl:static xl:z-auto">
          <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0">
            <Segmented<Format>
              layoutId="format-rule"
              value={format}
              onChange={setFormat}
              options={[
                {
                  value: "stories",
                  label: "Сторис",
                  icon: <GalleryHorizontalEnd size={15} aria-hidden />,
                  hint: `${edition.stories.frames.length} кадров`,
                },
                {
                  value: "carousel",
                  label: "Карусель",
                  icon: <LayoutGrid size={15} aria-hidden />,
                  hint: `${edition.carousel.slides.length} слайдов`,
                },
                {
                  value: "reel",
                  label: "Рилс",
                  icon: <Clapperboard size={15} aria-hidden />,
                  hint: `${edition.reel.script.length} реплик`,
                },
              ]}
            />
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={format + edition.id}
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduce ? undefined : { opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {format === "stories" && <StoriesView edition={edition} />}
            {format === "carousel" && <CarouselView edition={edition} />}
            {format === "reel" && <ReelView edition={edition} />}
          </motion.div>
        </AnimatePresence>
      </div>

      <ExpertLens edition={edition} />
      <FactsTable edition={edition} />
      <BackupTopics edition={edition} />
    </div>
  );
}
