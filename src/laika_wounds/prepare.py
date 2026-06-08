from __future__ import annotations

import argparse
from pathlib import Path

from .datasets import (
    DEFAULT_BURN_CLASSES,
    DatasetSummary,
    prepare_classification_folder_dataset,
    prepare_yolo_detection_dataset,
)


def print_summary(summary: DatasetSummary) -> None:
    print(f"Prepared {summary.task} dataset at: {summary.output}")
    print(f"Train: {summary.train_count} | Val: {summary.val_count} | Test: {summary.test_count}")
    print("Classes:", ", ".join(summary.classes))
    if summary.task == "detect":
        print(f"Ultralytics data file: {summary.output / 'data.yaml'}")


def kaggle_download(dataset: str) -> Path:
    import kagglehub

    return Path(kagglehub.dataset_download(dataset))


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare wound/burn datasets for YOLO training.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    kaggle_detect = subparsers.add_parser(
        "kaggle-detect",
        help="Download a Kaggle YOLO detection dataset and convert it to Ultralytics layout.",
    )
    kaggle_detect.add_argument("--dataset", default="shubhambaid/skin-burn-dataset")
    kaggle_detect.add_argument("--output", required=True, type=Path)
    kaggle_detect.add_argument("--seed", default=42, type=int)

    detect_folders = subparsers.add_parser(
        "detect-folders",
        help="Convert a local image+YOLO-label folder to Ultralytics layout.",
    )
    detect_folders.add_argument("--input", required=True, type=Path)
    detect_folders.add_argument("--output", required=True, type=Path)
    detect_folders.add_argument("--seed", default=42, type=int)

    classify_folders = subparsers.add_parser(
        "classify-folders",
        help="Split class folders into train/val/test for YOLO classification.",
    )
    classify_folders.add_argument("--input", required=True, type=Path)
    classify_folders.add_argument("--output", required=True, type=Path)
    classify_folders.add_argument("--seed", default=42, type=int)

    args = parser.parse_args()

    if args.command == "kaggle-detect":
        source = kaggle_download(args.dataset)
        summary = prepare_yolo_detection_dataset(
            source=source,
            output=args.output,
            class_names=DEFAULT_BURN_CLASSES,
            seed=args.seed,
        )
    elif args.command == "detect-folders":
        summary = prepare_yolo_detection_dataset(
            source=args.input,
            output=args.output,
            class_names=DEFAULT_BURN_CLASSES,
            seed=args.seed,
        )
    else:
        summary = prepare_classification_folder_dataset(
            source=args.input,
            output=args.output,
            seed=args.seed,
        )

    print_summary(summary)


if __name__ == "__main__":
    main()

