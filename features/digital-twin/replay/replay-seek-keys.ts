import { type KeyboardEvent } from "react";

export function stepReplayOnArrow(
  event: KeyboardEvent<HTMLInputElement>,
  step: (direction: -1 | 1) => void,
) {
  switch (event.key) {
    case "ArrowLeft":
    case "ArrowDown":
      event.preventDefault();
      step(-1);
      break;
    case "ArrowRight":
    case "ArrowUp":
      event.preventDefault();
      step(1);
      break;
  }
}
