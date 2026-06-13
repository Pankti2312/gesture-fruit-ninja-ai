import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { FruitNinjaGame } from "@/lib/game/FruitNinjaGame";

const searchSchema = z.object({
  mode: z.enum(["classic", "endless"]).catch("classic"),
  music: z.coerce.number().catch(0),
});

export const Route = createFileRoute("/play")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Play — Gesture Fruit Ninja" },
      { name: "description", content: "Slice fruit with your webcam and MediaPipe Hands." },
    ],
  }),
  component: Play,
});

function Play() {
  const { mode } = Route.useSearch();
  return <FruitNinjaGame mode={mode} initialMusic={true} />;
}