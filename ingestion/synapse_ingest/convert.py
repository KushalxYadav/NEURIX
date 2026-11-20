"""Optional LibreOffice conversion for legacy Office formats."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

CONVERSION_HELP = (
    "Convert the file to a modern format, then re-run the pipeline:\n"
    "  soffice --headless --convert-to {target} --outdir <folder> <file>\n"
    "or open it in Office and use File → Save As. Installing LibreOffice lets the "
    "pipeline convert automatically."
)


class ConversionError(RuntimeError):
    pass


def libreoffice_available() -> bool:
    return bool(shutil.which("soffice") or shutil.which("libreoffice"))


def convert_with_libreoffice(source: Path, out_dir: Path, target: str, timeout: int = 300) -> Path:
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    help_text = CONVERSION_HELP.format(target=target)
    if not soffice:
        raise ConversionError("LibreOffice (soffice) is not installed. " + help_text)
    out_dir.mkdir(parents=True, exist_ok=True)
    profile = (out_dir / ".lo-profile").resolve()
    command = [
        soffice,
        f"-env:UserInstallation=file://{profile}",
        "--headless",
        "--norestore",
        "--convert-to",
        target,
        "--outdir",
        str(out_dir),
        str(source),
    ]
    try:
        completed = subprocess.run(command, capture_output=True, text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise ConversionError(f"LibreOffice conversion timed out after {timeout}s. {help_text}") from exc
    output = out_dir / f"{source.stem}.{target}"
    if completed.returncode != 0 or not output.exists() or output.stat().st_size == 0:
        noise = ("javaldx", "java may not function")
        lines = (completed.stderr or completed.stdout or "").strip().splitlines()
        detail = " ".join(line.strip() for line in lines if line.strip() and not any(n in line for n in noise))[-400:]
        raise ConversionError(f"LibreOffice could not convert {source.name}. {detail}\n{help_text}")
    return output
