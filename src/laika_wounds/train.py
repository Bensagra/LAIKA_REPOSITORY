from __future__ import annotations

import argparse
from pathlib import Path

from ultralytics import YOLO


def train_model(
    task: str,
    data: Path,
    model_name: str,
    epochs: int,
    imgsz: int,
    batch: int,
    project: str,
    name: str,
    device: str | None,
) -> None:
    model = YOLO(model_name)
    model.train(
        task=task,
        data=str(data),
        epochs=epochs,
        imgsz=imgsz,
        batch=batch,
        project=project,
        name=name,
        device=device,
        patience=15,
        plots=True,
        seed=42,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Train YOLO models for wound AI.")
    subparsers = parser.add_subparsers(dest="task", required=True)

    for task, default_model in {
        "detect": "yolo11n.pt",
        "classify": "yolo11n-cls.pt",
    }.items():
        sub = subparsers.add_parser(task)
        sub.add_argument("--data", required=True, type=Path)
        sub.add_argument("--model", default=default_model)
        sub.add_argument("--epochs", default=80 if task == "detect" else 50, type=int)
        sub.add_argument("--imgsz", default=640 if task == "detect" else 224, type=int)
        sub.add_argument("--batch", default=16 if task == "detect" else 32, type=int)
        sub.add_argument("--project", default="runs/wound-ai")
        sub.add_argument("--name", default=f"wound-{task}")
        sub.add_argument("--device", default=None)

    args = parser.parse_args()
    train_model(
        task=args.task,
        data=args.data,
        model_name=args.model,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project=args.project,
        name=args.name,
        device=args.device,
    )


if __name__ == "__main__":
    main()
