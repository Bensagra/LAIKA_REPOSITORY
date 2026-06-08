from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def main() -> None:
    parser = argparse.ArgumentParser(description="Run prediction with a trained YOLO wound model.")
    subparsers = parser.add_subparsers(dest="task", required=True)

    for task in ("detect", "classify"):
        sub = subparsers.add_parser(task)
        sub.add_argument("--model", required=True, type=Path)
        sub.add_argument("--source", required=True)
        sub.add_argument("--conf", default=0.25, type=float)
        sub.add_argument("--imgsz", default=640 if task == "detect" else 224, type=int)
        sub.add_argument("--project", default="runs/wound-ai")
        sub.add_argument("--name", default=f"predict-{task}")
        sub.add_argument("--save", action="store_true", default=True)

    args = parser.parse_args()
    model = YOLO(str(args.model))
    model.predict(
        task=args.task,
        source=args.source,
        conf=args.conf,
        imgsz=args.imgsz,
        project=args.project,
        name=args.name,
        save=args.save,
    )


if __name__ == "__main__":
    main()

