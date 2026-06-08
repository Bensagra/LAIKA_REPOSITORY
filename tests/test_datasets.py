from pathlib import Path

from PIL import Image

from laika_wounds.datasets import (
    prepare_classification_folder_dataset,
    prepare_yolo_detection_dataset,
)


def make_image(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (32, 32), color=(200, 50, 50)).save(path)


def test_prepare_yolo_detection_dataset(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    for idx in range(12):
        image = raw / "images" / f"burn_{idx}.jpg"
        make_image(image)
        label = raw / "labels" / f"burn_{idx}.txt"
        label.parent.mkdir(parents=True, exist_ok=True)
        label.write_text(f"{idx % 3} 0.5 0.5 0.4 0.4\n")

    out = tmp_path / "processed"
    summary = prepare_yolo_detection_dataset(raw, out)

    assert summary.task == "detect"
    assert (out / "data.yaml").exists()
    assert summary.train_count + summary.val_count + summary.test_count == 12
    assert summary.classes == ["first_degree_burn", "second_degree_burn", "third_degree_burn"]


def test_prepare_classification_folder_dataset(tmp_path: Path) -> None:
    raw = tmp_path / "raw"
    for label in ("burn", "cut"):
        for idx in range(6):
            make_image(raw / label / f"{idx}.jpg")

    out = tmp_path / "processed_cls"
    summary = prepare_classification_folder_dataset(raw, out)

    assert summary.task == "classify"
    assert (out / "train" / "burn").exists()
    assert (out / "val" / "cut").exists()
    assert summary.train_count + summary.val_count + summary.test_count == 12

