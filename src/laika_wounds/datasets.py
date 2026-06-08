from __future__ import annotations

import random
import shutil
from dataclasses import dataclass
from pathlib import Path

import yaml
from PIL import Image
from sklearn.model_selection import train_test_split

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
DEFAULT_BURN_CLASSES = {
    0: "first_degree_burn",
    1: "second_degree_burn",
    2: "third_degree_burn",
}


@dataclass(frozen=True)
class DatasetSummary:
    output: Path
    task: str
    train_count: int
    val_count: int
    test_count: int
    classes: list[str]


def find_images(root: Path) -> list[Path]:
    return sorted(p for p in root.rglob("*") if p.suffix.lower() in IMAGE_EXTENSIONS)


def matching_yolo_label(image_path: Path) -> Path | None:
    candidates = [
        image_path.with_suffix(".txt"),
        image_path.parent.parent / "labels" / image_path.with_suffix(".txt").name,
        image_path.parent.parent / "labels" / image_path.parent.name / image_path.with_suffix(".txt").name,
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def read_label_classes(label_path: Path) -> set[int]:
    class_ids: set[int] = set()
    for line in label_path.read_text().splitlines():
        parts = line.strip().split()
        if not parts:
            continue
        try:
            class_ids.add(int(float(parts[0])))
        except ValueError:
            continue
    return class_ids


def infer_detection_classes(labels: list[Path], class_names: dict[int, str] | None = None) -> list[str]:
    class_ids: set[int] = set()
    for label in labels:
        class_ids.update(read_label_classes(label))

    if not class_ids and class_names:
        class_ids = set(class_names)
    if not class_ids:
        raise ValueError("No YOLO class ids were found in labels.")

    names: list[str] = []
    source = class_names or DEFAULT_BURN_CLASSES
    for class_id in range(max(class_ids) + 1):
        names.append(source.get(class_id, f"class_{class_id}"))
    return names


def prepare_yolo_detection_dataset(
    source: Path,
    output: Path,
    class_names: dict[int, str] | None = None,
    seed: int = 42,
    val_size: float = 0.15,
    test_size: float = 0.10,
) -> DatasetSummary:
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()

    pairs = []
    for image in find_images(source):
        label = matching_yolo_label(image)
        if label and label.exists():
            pairs.append((image, label))

    if not pairs:
        raise ValueError(f"No image/YOLO-label pairs found under {source}")

    labels = [label for _, label in pairs]
    classes = infer_detection_classes(labels, class_names)

    train_pairs, holdout_pairs = train_test_split(
        pairs,
        test_size=val_size + test_size,
        random_state=seed,
        shuffle=True,
    )
    relative_test_size = test_size / (val_size + test_size)
    val_pairs, test_pairs = train_test_split(
        holdout_pairs,
        test_size=relative_test_size,
        random_state=seed,
        shuffle=True,
    )

    if output.exists():
        shutil.rmtree(output)

    for split_name, split_pairs in {
        "train": train_pairs,
        "val": val_pairs,
        "test": test_pairs,
    }.items():
        image_dir = output / "images" / split_name
        label_dir = output / "labels" / split_name
        image_dir.mkdir(parents=True, exist_ok=True)
        label_dir.mkdir(parents=True, exist_ok=True)
        for image, label in split_pairs:
            target_image = image_dir / image.name
            target_label = label_dir / label.name
            shutil.copy2(image, target_image)
            shutil.copy2(label, target_label)

    data_yaml = {
        "path": str(output),
        "train": "images/train",
        "val": "images/val",
        "test": "images/test",
        "names": {idx: name for idx, name in enumerate(classes)},
    }
    (output / "data.yaml").write_text(yaml.safe_dump(data_yaml, sort_keys=False))

    return DatasetSummary(
        output=output,
        task="detect",
        train_count=len(train_pairs),
        val_count=len(val_pairs),
        test_count=len(test_pairs),
        classes=classes,
    )


def valid_image(path: Path) -> bool:
    try:
        with Image.open(path) as image:
            image.verify()
        return True
    except Exception:
        return False


def prepare_classification_folder_dataset(
    source: Path,
    output: Path,
    seed: int = 42,
    val_size: float = 0.15,
    test_size: float = 0.10,
) -> DatasetSummary:
    source = source.expanduser().resolve()
    output = output.expanduser().resolve()
    class_dirs = sorted(p for p in source.iterdir() if p.is_dir())
    if not class_dirs:
        raise ValueError(f"No class folders found under {source}")

    samples: list[tuple[Path, str]] = []
    for class_dir in class_dirs:
        for image in find_images(class_dir):
            if valid_image(image):
                samples.append((image, class_dir.name))

    if not samples:
        raise ValueError(f"No valid images found under {source}")

    random.seed(seed)
    train_samples, holdout_samples = train_test_split(
        samples,
        test_size=val_size + test_size,
        random_state=seed,
        shuffle=True,
        stratify=[label for _, label in samples] if _can_stratify(samples) else None,
    )
    relative_test_size = test_size / (val_size + test_size)
    val_samples, test_samples = train_test_split(
        holdout_samples,
        test_size=relative_test_size,
        random_state=seed,
        shuffle=True,
        stratify=[label for _, label in holdout_samples] if _can_stratify(holdout_samples) else None,
    )

    if output.exists():
        shutil.rmtree(output)

    class_names = [p.name for p in class_dirs]
    for split_name in ("train", "val", "test"):
        for class_name in class_names:
            (output / split_name / class_name).mkdir(parents=True, exist_ok=True)

    for split_name, split_samples in {
        "train": train_samples,
        "val": val_samples,
        "test": test_samples,
    }.items():
        for image, label in split_samples:
            target_dir = output / split_name / label
            shutil.copy2(image, target_dir / image.name)

    return DatasetSummary(
        output=output,
        task="classify",
        train_count=len(train_samples),
        val_count=len(val_samples),
        test_count=len(test_samples),
        classes=class_names,
    )


def _can_stratify(samples: list[tuple[Path, str]]) -> bool:
    counts: dict[str, int] = {}
    for _, label in samples:
        counts[label] = counts.get(label, 0) + 1
    return bool(counts) and min(counts.values()) >= 2
