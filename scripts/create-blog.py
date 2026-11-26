# -*- coding: utf-8 -*-
"""
Markdown dosyasını (veya komut satırı argümanlarını) Strapi 5 "blocks" formatına
çevirip blog yazısı olarak yükler. Başlıklar, listeler, alıntılar, kod blokları ve
görseller otomatik dönüştürülür; SEO alanları verilmezse üretilir.

Kullanım (PowerShell):
  # 0. Oturumda bir kez: canlı Strapi adresi ve token'ı
  $env:STRAPI_URL   = "https://admin.ketalearn.cloud"
  $env:STRAPI_TOKEN = "xxxx"          # Settings → API Tokens → Full access

  # 1. Markdown dosyasından blog oluştur ve yayınla:
  python scripts/create-blog.py bloglarim/sinav-kaygisi.md

  # 2. Her şeyi komut satırından ver:
  python scripts/create-blog.py `
      --title "Sınav Kaygısıyla Başa Çıkma" `
      --body-file icerik.md `
      --category Lise `
      --image ./kapak.png `
      --meta-title "Sınav Kaygısı | KetaLearn" `
      --meta-description "Sınav kaygısını azaltmanın 5 pratik yolu." `
      --keywords "sınav kaygısı, motivasyon, lise"

  # 3. Kapak görselini açık lisanslı (ücretsiz kullanılabilir) stok görsellerden bul:
  python scripts/create-blog.py icerik.md --stock-image "student writing exam"
  #    Hiç görsel belirtilmezse bu arama başlıktan üretilen sorguyla OTOMATİK yapılır
  #    (Openverse, API anahtarı gerektirmez; lisans ve atıf yazdırılır, atıf görselin
  #    caption alanına da yazılır).

  # 4. Kapak görselini yapay zekâ ile üret (OPENAI_API_KEY gerekir):
  python scripts/create-blog.py icerik.md --ai-image "sakin bir çalışma masası, pastel tonlar"

  # 5. Strapi'ye yazmadan dönüştürmeyi önizle (sunucuya yalnızca okuma isteği gider):
  python scripts/create-blog.py icerik.md --dry-run --save-json payload.json

  # 6. Taslak olarak kaydet / mevcut slug'ı güncelle:
  python scripts/create-blog.py icerik.md --draft
  python scripts/create-blog.py icerik.md --update

  # Yerel geliştirme örneğine karşı çalıştırmak için:
  python scripts/create-blog.py icerik.md --strapi-url http://localhost:41337

  DİKKAT: --draft verilmediğinde yazı doğrudan YAYINLANIR (REST ?status=published).

Dosya düzeni:
  content/blogs/yazim.md      → yazının markdown'ı (sen yazarsın, script üretmez)
  content/images/yazim.jpg    → web'den bulunan veya AI ile üretilen kapak görseli
                                (script buraya kaydeder; bir sonraki çalıştırmada
                                 aynı görseli bulur ve yeniden arama yapmaz)

  --image VERMEZSEN script açık lisanslı bir görseli kendisi bulur, content/images
  altına kaydeder ve Strapi'ye yükler. --image ./kapak.png verirsen o dosyanın
  gerçekten var olması gerekir (markdown dosyasının klasörüne göre aranır).

Markdown biçimi (ön bilgi bloğu isteğe bağlıdır):
  ---
  title: Sınav Kaygısıyla Başa Çıkma
  slug: sinav-kaygisiyla-basa-cikma        # verilmezse title'dan üretilir
  category: Lise                            # Lise | Üniversite | Mezun | Doktora | Üniversite Hazırlık
  isPopular: false
  page: demo-yazilar                        # ilişkili Page slug'ı (mevcut bir Page olmalı)
  image: ./kapak.png                        # yerel yol veya http(s) URL (verilirse stok arama atlanır)
  imageQuery: student studying exam         # açık lisanslı stok görsel arama sorgusu
  aiImage: pastel tonlarda çalışma masası    # AI ile kapak üretimi (OPENAI_API_KEY gerekir)
  imageAlt: Sınav kaygısı kapak görseli
  imageCaption: Fotoğraf: ...               # verilmezse stok atfı otomatik yazılır
  metaTitle: ...
  metaDescription: ...
  keywords: a, b, c
  ---

  ## Başlık                -> heading (level 2)
  Paragraf, **kalın**, *italik*, ~~üstü çizili~~, `kod`, [bağlantı](https://...)
  - madde                  -> unordered list
  1. madde                 -> ordered list
  > alıntı                 -> quote
  ```python                -> code
  ![alt](./gorsel.png)     -> image block (dosya Strapi'ye yüklenir)
"""

import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

SITE_NAME = "KetaLearn"
DEFAULT_STRAPI_URL = "https://admin.ketalearn.cloud"
CATEGORIES = ["Lise", "Üniversite", "Mezun", "Doktora", "Üniversite Hazırlık"]

# Markdown content/blogs/ altında tutulur, kapak görselleri content/images/ altına kaydedilir.
CONTENT_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_IMAGE_DIR = CONTENT_ROOT / "content" / "images"
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
OPENAI_IMAGES_URL = "https://api.openai.com/v1/images/generations"

for stream in (sys.stdout, sys.stderr):
    try:
        stream.reconfigure(encoding="utf-8")
    except Exception:
        pass


# ─── .env ve Ortam Değişkenleri ──────────────────────────────────────────────

def load_dotenv() -> None:
    """Çalışma dizini veya üst dizinlerdeki .env dosyasını ortam değişkenlerine ekler."""
    search_dirs = [
        Path.cwd(),
        Path.cwd().parent,
        Path(__file__).resolve().parent.parent,
        Path(__file__).resolve().parent.parent.parent,
    ]
    for d in search_dirs:
        env_file = d / ".env"
        if env_file.is_file():
            try:
                with open(env_file, "r", encoding="utf-8") as f:
                    for line in f:
                        line = line.strip()
                        if not line or line.startswith("#") or "=" not in line:
                            continue
                        k, v = line.split("=", 1)
                        k, v = k.strip(), v.strip().strip("\"'")
                        if k not in os.environ:
                            os.environ[k] = v
            except Exception:
                pass
            break


# ─── Metin Yardımcıları ──────────────────────────────────────────────────────

TR_MAP = str.maketrans({
    "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
    "Ç": "c", "Ğ": "g", "I": "i", "İ": "i", "Ö": "o", "Ş": "s", "Ü": "u",
})


def slugify(text: str) -> str:
    """Türkçe karakterleri dönüştürerek URL uyumlu slug üretir."""
    text = text.translate(TR_MAP).lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-") or "blog"


def truncate(text: str, max_len: int = 155) -> str:
    """Metni kelime sınırından keser."""
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= max_len:
        return clean
    cut = clean[: max_len - 1]
    last_space = cut.rfind(" ")
    split_point = last_space if last_space >= max_len // 2 else max_len - 1
    return cut[:split_point].strip() + "…"


def ascii_filename(name: str, fallback: str = "gorsel") -> str:
    """HTTP başlığında güvenli, ASCII bir dosya adı üretir."""
    base = slugify(Path(name).stem) or fallback
    ext = Path(name).suffix.lower() or ".png"
    if not re.fullmatch(r"\.[a-z0-9]{2,5}", ext):
        ext = ".png"
    return f"{base}{ext}"


def guess_mime(source: str, raw: bytes) -> str:
    mime = mimetypes.guess_type(source)[0]
    if mime:
        return mime
    if raw[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if raw[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if raw[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


# ─── Markdown → Strapi Blocks ────────────────────────────────────────────────

INLINE_PATTERN = re.compile(
    r"\*\*\*(?P<bold_italic>.+?)\*\*\*"
    r"|\*\*(?P<bold>.+?)\*\*"
    r"|__(?P<bold_us>.+?)__"
    r"|\*(?P<italic>[^*\n]+?)\*"
    r"|~~(?P<strike>.+?)~~"
    r"|`(?P<code>[^`\n]+?)`"
    r"|\[(?P<link_text>[^\]]+)\]\((?P<link_url>[^)\s]+)\)"
)

MODIFIER_GROUPS = {
    "bold": {"bold": True},
    "bold_us": {"bold": True},
    "italic": {"italic": True},
    "strike": {"strikethrough": True},
    "code": {"code": True},
    "bold_italic": {"bold": True, "italic": True},
}

LIST_ITEM_RE = re.compile(r"^(?P<indent>[ \t]*)(?P<marker>[-*+]|\d+[.)])[ \t]+(?P<text>.*)$")
HEADING_RE = re.compile(r"^(?P<hashes>#{1,6})[ \t]+(?P<text>.*?)[ \t]*#*$")
IMAGE_RE = re.compile(r"^!\[(?P<alt>[^\]]*)\]\((?P<src>[^)\s]+)(?:[ \t]+\"(?P<title>[^\"]*)\")?\)$")
FENCE_RE = re.compile(r"^(?P<fence>`{3,}|~{3,})[ \t]*(?P<syntax>[A-Za-z0-9_+-]*)[ \t]*$")
HR_RE = re.compile(r"^([ \t]*)(-{3,}|\*{3,}|_{3,})[ \t]*$")


def text_node(text: str, **modifiers: bool) -> Dict[str, Any]:
    node: Dict[str, Any] = {"type": "text", "text": text}
    node.update({k: True for k, v in modifiers.items() if v})
    return node


def parse_inline(text: str) -> List[Dict[str, Any]]:
    """Satır içi markdown biçimlendirmesini blocks "text"/"link" düğümlerine çevirir."""
    nodes: List[Dict[str, Any]] = []
    pos = 0
    for match in INLINE_PATTERN.finditer(text):
        if match.start() > pos:
            nodes.append(text_node(text[pos: match.start()]))

        if match.group("link_text") is not None:
            url = match.group("link_url")
            if not url.startswith("/"):
                try:
                    urllib.parse.urlparse(url)
                    if "://" not in url:
                        url = f"https://{url}"
                except ValueError:
                    url = "/"
            nodes.append({
                "type": "link",
                "url": url,
                "children": parse_inline_plain(match.group("link_text")),
            })
        else:
            for group, modifiers in MODIFIER_GROUPS.items():
                value = match.group(group)
                if value is not None:
                    nodes.append(text_node(value, **modifiers))
                    break
        pos = match.end()

    if pos < len(text):
        nodes.append(text_node(text[pos:]))
    if not nodes:
        nodes.append(text_node(text))
    return nodes


def parse_inline_plain(text: str) -> List[Dict[str, Any]]:
    """Bağlantı metinleri için yalnızca "text" düğümleri üretir (iç içe link yasak)."""
    nodes: List[Dict[str, Any]] = []
    pos = 0
    for match in INLINE_PATTERN.finditer(text):
        if match.start() > pos:
            nodes.append(text_node(text[pos: match.start()]))
        if match.group("link_text") is not None:
            nodes.append(text_node(match.group("link_text")))
        else:
            for group, modifiers in MODIFIER_GROUPS.items():
                value = match.group(group)
                if value is not None:
                    nodes.append(text_node(value, **modifiers))
                    break
        pos = match.end()
    if pos < len(text):
        nodes.append(text_node(text[pos:]))
    return nodes or [text_node(text)]


def expand_indent(indent: str) -> int:
    """Sekmeyi 4 boşluk sayarak girinti genişliğini verir."""
    return sum(4 if c == "\t" else 1 for c in indent)


def build_list(items: List[Tuple[int, bool, str]], index: int, indent: int) -> Tuple[Dict[str, Any], int]:
    """Girinti düzeylerine göre (iç içe olabilen) liste bloğu kurar."""
    node: Dict[str, Any] = {
        "type": "list",
        "format": "ordered" if items[index][1] else "unordered",
        "children": [],
    }
    while index < len(items):
        item_indent, ordered, text = items[index]
        if item_indent < indent:
            break
        if item_indent > indent:
            child, index = build_list(items, index, item_indent)
            node["children"].append(child)
            continue
        node["children"].append({"type": "list-item", "children": parse_inline(text)})
        index += 1
    return node, index


def parse_frontmatter(raw: str) -> Tuple[Dict[str, Any], str]:
    """--- ile çevrili ön bilgi bloğunu ayırır (PyYAML gerektirmez)."""
    if not raw.startswith("---"):
        return {}, raw
    lines = raw.splitlines()
    if len(lines) < 2:
        return {}, raw
    meta: Dict[str, Any] = {}
    for idx in range(1, len(lines)):
        if lines[idx].strip() in ("---", "..."):
            body = "\n".join(lines[idx + 1:]).lstrip("\n")
            return meta, body
        line = lines[idx].strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        value = value.strip()
        if value[:1] in ("'", '"'):
            value = value.strip("\"'")
        else:
            # YAML'daki gibi satır sonu yorumlarını at: "slug: ornek  # yorum"
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip().strip("\"'")
        lowered = value.lower()
        if lowered in ("true", "yes"):
            meta[key.strip()] = True
        elif lowered in ("false", "no"):
            meta[key.strip()] = False
        else:
            meta[key.strip()] = value
    return {}, raw


def markdown_to_blocks(
    markdown: str,
    resolve_image: Optional[Callable[[str, str], Optional[Dict[str, Any]]]] = None,
) -> Tuple[List[Dict[str, Any]], List[str]]:
    """Markdown gövdesini Strapi blocks dizisine çevirir; (blocks, uyarılar) döner."""
    blocks: List[Dict[str, Any]] = []
    warnings: List[str] = []
    lines = markdown.splitlines()
    i = 0

    def flush_paragraph(buffer: List[str]) -> None:
        text = " ".join(part.strip() for part in buffer).strip()
        if text:
            blocks.append({"type": "paragraph", "children": parse_inline(text)})
        buffer.clear()

    paragraph: List[str] = []

    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Kod bloğu
        fence = FENCE_RE.match(stripped)
        if fence:
            flush_paragraph(paragraph)
            closing = fence.group("fence")[0] * len(fence.group("fence"))
            code_lines: List[str] = []
            i += 1
            while i < len(lines):
                candidate = lines[i].strip()
                if candidate.startswith(closing) and FENCE_RE.match(candidate):
                    i += 1
                    break
                code_lines.append(lines[i])
                i += 1
            else:
                warnings.append("Kapanmayan kod bloğu: dosya sonuna kadar okundu.")
            blocks.append({
                "type": "code",
                "syntax": fence.group("syntax") or None,
                "children": [text_node("\n".join(code_lines))],
            })
            continue

        # Boş satır
        if not stripped:
            flush_paragraph(paragraph)
            i += 1
            continue

        # Yatay çizgi (blocks'ta karşılığı yok)
        if HR_RE.match(stripped) and not LIST_ITEM_RE.match(stripped):
            flush_paragraph(paragraph)
            warnings.append(f"Satır {i + 1}: yatay çizgi atlandı (blocks'ta 'hr' tipi yok).")
            i += 1
            continue

        # Başlık
        heading = HEADING_RE.match(stripped)
        if heading:
            flush_paragraph(paragraph)
            text = heading.group("text").strip()
            if text:
                blocks.append({
                    "type": "heading",
                    "level": len(heading.group("hashes")),
                    "children": parse_inline(text),
                })
            i += 1
            continue

        # Alıntı
        if stripped.startswith(">"):
            flush_paragraph(paragraph)
            quote_lines: List[str] = []
            while i < len(lines) and lines[i].strip().startswith(">"):
                quote_lines.append(re.sub(r"^[ \t]*>[ \t]?", "", lines[i]))
                i += 1
            text = " ".join(q.strip() for q in quote_lines).strip()
            if text:
                blocks.append({"type": "quote", "children": parse_inline(text)})
            continue

        # Görsel (tek başına satır)
        image = IMAGE_RE.match(stripped)
        if image:
            flush_paragraph(paragraph)
            src = image.group("src")
            alt = image.group("alt") or image.group("title") or ""
            file_object = resolve_image(src, alt) if resolve_image else None
            if file_object:
                blocks.append({
                    "type": "image",
                    "image": file_object,
                    "children": [text_node("")],
                })
            else:
                warnings.append(f"Satır {i + 1}: görsel yüklenemedi, blok atlandı → {src}")
            i += 1
            continue

        # Liste
        if LIST_ITEM_RE.match(line) and not IMAGE_RE.match(stripped):
            flush_paragraph(paragraph)
            items: List[Tuple[int, bool, str]] = []
            while i < len(lines):
                item = LIST_ITEM_RE.match(lines[i])
                if not item:
                    # Liste maddesinin devam satırı (girintili metin)
                    if lines[i].strip() and (items and expand_indent(lines[i][: len(lines[i]) - len(lines[i].lstrip())]) > items[-1][0]):
                        items[-1] = (items[-1][0], items[-1][1], f"{items[-1][2]} {lines[i].strip()}")
                        i += 1
                        continue
                    break
                marker = item.group("marker")
                items.append((
                    expand_indent(item.group("indent")),
                    marker[0].isdigit(),
                    item.group("text").strip(),
                ))
                i += 1
            if items:
                base_indent = items[0][0]
                node, _ = build_list(items, 0, base_indent)
                blocks.append(node)
            continue

        paragraph.append(stripped)
        i += 1

    flush_paragraph(paragraph)

    if not blocks:
        blocks.append({"type": "paragraph", "children": [text_node(markdown.strip())]})
    return blocks, warnings


def blocks_plain_text(blocks: List[Dict[str, Any]]) -> str:
    """Bloklardan düz metin çıkarır (SEO açıklaması ve özet için).

    Satır içi düğümler boşluksuz birleştirilir: boşluklar zaten text düğümlerinin
    içinde taşınır, aksi halde "tanırsın ." gibi bozuk metinler oluşur.
    """
    def collect(nodes: Any, parts: List[str]) -> None:
        if isinstance(nodes, dict):
            if nodes.get("type") == "list-item":
                collect(nodes.get("children"), parts)
                parts.append(" ")
                return
            if nodes.get("type") == "text" and isinstance(nodes.get("text"), str):
                parts.append(nodes["text"])
            for key in ("children", "image"):
                if key in nodes:
                    collect(nodes[key], parts)
        elif isinstance(nodes, list):
            for item in nodes:
                collect(item, parts)

    sentences: List[str] = []
    for block in blocks:
        parts: List[str] = []
        collect(block, parts)
        text = re.sub(r"\s+", " ", "".join(parts)).strip()
        if text:
            sentences.append(text)
    return " ".join(sentences)


# ─── Strapi REST İstemcisi ───────────────────────────────────────────────────

class StrapiClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, path: str, method: str = "GET", data: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.base_url}/api/{path.lstrip('/')}"
        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}
        body = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                text = resp.read().decode("utf-8")
                return json.loads(text) if text else {}
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"{method} /api/{path} → {err.code}: {err.read().decode('utf-8', 'replace')}")
        except urllib.error.URLError as err:
            raise RuntimeError(f"{method} /api/{path} → bağlantı hatası: {err.reason}")

    def upload(self, filename: str, content: bytes, mime: str, alt: str = "", caption: str = "") -> Dict[str, Any]:
        """Dosyayı /api/upload üzerinden yükler ve tam dosya nesnesini döner."""
        boundary = uuid.uuid4().hex
        safe_name = ascii_filename(filename)
        file_info = {"name": Path(filename).stem or safe_name, "alternativeText": alt, "caption": caption}

        chunks = [
            (
                # fileInfo parçasına Content-Type eklenirse Strapi değeri ham metin
                # sayar ve alternativeText/caption alanlarını sessizce düşürür.
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="fileInfo"\r\n\r\n'
                f"{json.dumps(file_info, ensure_ascii=False)}\r\n"
            ).encode("utf-8"),
            (
                f"--{boundary}\r\n"
                f'Content-Disposition: form-data; name="files"; filename="{safe_name}"\r\n'
                f"Content-Type: {mime}\r\n\r\n"
            ).encode("utf-8"),
            content,
            f"\r\n--{boundary}--\r\n".encode("utf-8"),
        ]
        payload = b"".join(chunks)
        req = urllib.request.Request(
            f"{self.base_url}/api/upload",
            data=payload,
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=300) as resp:
                result = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            raise RuntimeError(f"POST /api/upload → {err.code}: {err.read().decode('utf-8', 'replace')}")

        file_object = result[0] if isinstance(result, list) else result
        if not isinstance(file_object, dict) or "url" not in file_object:
            raise RuntimeError(f"Beklenmeyen yükleme yanıtı: {json.dumps(result)[:400]}")
        return file_object

    def find_file_by_url(self, url: str) -> Optional[Dict[str, Any]]:
        """Strapi medya kütüphanesinde aynı URL'ye sahip dosyayı arar."""
        encoded = urllib.parse.quote(url, safe="")
        try:
            res = self.request(f"upload/files?filters[url][$eq]={encoded}&pagination[pageSize]=1")
        except RuntimeError:
            return None
        # /api/upload/files düz bir dizi döndürür, {data: [...]} değil.
        data = res if isinstance(res, list) else (res.get("data") or [])
        return data[0] if data else None

    def find_file_by_name(self, name: str) -> Optional[Dict[str, Any]]:
        """Medya kütüphanesinde aynı ada sahip dosyayı arar.

        Bu script kapak görsellerini daima slug adıyla yükler; böylece aynı yazı
        yeniden çalıştırıldığında aynı medya kaydı kullanılır, yeni kopya oluşmaz.
        """
        encoded = urllib.parse.quote(name, safe="")
        try:
            res = self.request(
                f"upload/files?filters[name][$eq]={encoded}&sort=id:desc&pagination[pageSize]=1"
            )
        except RuntimeError:
            return None
        data = res if isinstance(res, list) else (res.get("data") or [])
        return data[0] if data else None

    def find_one(self, collection: str, field: str, value: str, status: str = "draft") -> Optional[Dict[str, Any]]:
        encoded = urllib.parse.quote(value)
        path = (
            f"{collection}?filters[{field}][$eq]={encoded}&status={status}"
            f"&fields[0]=documentId&fields[1]=slug&fields[2]=title&pagination[pageSize]=1"
        )
        res = self.request(path)
        data = res.get("data") or []
        return data[0] if data else None


def download_bytes(url: str, retries: int = 3) -> bytes:
    """URL'den baytları indirir; 429/5xx durumlarında geri çekilerek yeniden dener.

    Wikimedia gibi sağlayıcılar kimliksiz istemcileri hızla 429'lar; bu yüzden
    aracı tanıtan bir User-Agent gönderilir.
    """
    last_error: Optional[Exception] = None
    user_agent = os.environ.get("STOCK_IMAGE_UA") or STOCK_USER_AGENT_DEFAULT
    for attempt in range(retries):
        req = urllib.request.Request(
            url,
            headers={"User-Agent": user_agent, "Accept": "image/*,*/*;q=0.8"},
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            last_error = err
            if err.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
        except urllib.error.URLError as err:
            last_error = err
            if attempt == retries - 1:
                raise
        time.sleep(3 * (attempt + 1))
    raise last_error or RuntimeError(f"İndirilemedi: {url}")


# ─── Görsel Kaynakları ───────────────────────────────────────────────────────

def generate_ai_image(prompt: str, size: str = "1536x1024") -> Tuple[bytes, str]:
    """OpenAI görsel üretim API'siyle kapak görseli üretir (OPENAI_API_KEY gerekir)."""
    api_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("IMAGEGEN_API_KEY")
    if not api_key:
        raise RuntimeError(
            "AI görsel üretimi için OPENAI_API_KEY tanımlı değil. "
            "Ya anahtarı .env'e ekleyin ya da --image <dosya|url> kullanın."
        )
    model = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
    payload = {"model": model, "prompt": prompt, "size": size, "n": 1}
    req = urllib.request.Request(
        OPENAI_IMAGES_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as err:
        raise RuntimeError(f"AI görsel üretimi başarısız → {err.code}: {err.read().decode('utf-8', 'replace')}")

    items = result.get("data") or []
    if not items:
        raise RuntimeError(f"AI görsel üretimi boş yanıt döndü: {json.dumps(result)[:300]}")
    item = items[0]
    if item.get("b64_json"):
        return base64.b64decode(item["b64_json"]), "image/png"
    if item.get("url"):
        raw = download_bytes(item["url"])
        return raw, guess_mime(item["url"], raw)
    raise RuntimeError("AI görsel üretimi yanıtında ne b64_json ne de url var.")


def default_image_dir(base_dir: Path) -> Path:
    """Markdown content/blogs/ içindeyse görseller content/images/ altına gider."""
    sibling = base_dir.parent / "images"
    return sibling if base_dir.name == "blogs" else DEFAULT_IMAGE_DIR


def find_cached_cover(image_dir: Path, slug: str) -> Optional[Path]:
    """Daha önce indirilmiş/üretilmiş kapak görselini (images/<slug>.*) bulur."""
    if not image_dir.is_dir():
        return None
    for ext in IMAGE_EXTENSIONS:
        candidate = image_dir / f"{slug}{ext}"
        if candidate.is_file():
            return candidate
    return None


def save_local_image(image_dir: Optional[Path], slug: str, raw: bytes, mime: str) -> Optional[Path]:
    """Web'den bulunan ya da üretilen görselin bir kopyasını content/images altına yazar."""
    if not image_dir:
        return None
    try:
        image_dir.mkdir(parents=True, exist_ok=True)
        path = image_dir / f"{slug}{ext_from_mime(mime)}"
        path.write_bytes(raw)
        return path
    except OSError:
        return None


def normalize_media(file_object: Dict[str, Any]) -> Dict[str, Any]:
    """Bloğa gömülecek medya nesnesini Strapi doğrulayıcısının istediği biçime sokar.

    Strapi küçük görseller için türetilmiş boyut üretmez ve `formats: null` döner;
    blocks doğrulayıcısı ise `formats` alanını zorunlu bir nesne olarak ister ve
    null değerinde yazıyı 400 ile reddeder.
    """
    media = dict(file_object or {})
    if not isinstance(media.get("formats"), dict):
        media["formats"] = {}
    for key in ("width", "height", "size"):
        if not isinstance(media.get(key), (int, float)):
            media[key] = 0
    for key in ("name", "url", "hash", "ext", "mime", "provider"):
        if not isinstance(media.get(key), str):
            media[key] = ""
    return media


def load_image_source(source: str, base_dir: Path) -> Tuple[bytes, str, str]:
    """Yerel dosya veya http(s) URL'sinden (bytes, mime, isim) üçlüsü üretir."""
    if source.startswith(("http://", "https://")):
        raw = download_bytes(source)
        name = Path(urllib.parse.urlparse(source).path).name or "gorsel"
        return raw, guess_mime(source, raw), name

    path = (base_dir / source).resolve() if not Path(source).is_absolute() else Path(source)
    if not path.is_file():
        raise RuntimeError(f"Görsel dosyası bulunamadı: {path}")
    return path.read_bytes(), guess_mime(str(path), path.read_bytes()[:16]), path.name


# ─── Açık Lisanslı (Ücretsiz Kullanılabilir) Görsel Arama ────────────────────
# Openverse (openverse.org) API anahtarı gerektirmez ve Flickr/Wikimedia gibi
# kaynaklardaki Creative Commons görselleri lisans bilgisiyle birlikte döner.

OPENVERSE_SEARCH_URL = "https://api.openverse.org/v1/images/"
USER_AGENT = f"{SITE_NAME}-blog-script/1.0"
STOCK_USER_AGENT_DEFAULT = (
    f"{SITE_NAME}BlogScript/1.0 (https://ketalearn.cloud) Python-urllib"
)
MIN_IMAGE_BYTES = 12_000
MAX_IMAGE_BYTES = 12_000_000
MIN_STOCK_CANDIDATES = 4

STOCK_QUERY_HINTS: List[Tuple[Tuple[str, ...], str]] = [
    (("sınav", "sinav", "yks", "tyt", "ayt", "lgs", "oyss", "test", "deneme"), "student writing exam paper desk"),
    (("kaygı", "kaygi", "stres", "motivasyon", "odak"), "calm student studying notebook"),
    (("matematik", "math", "geometri", "fizik", "kimya"), "mathematics formulas notebook pencil"),
    (("edebiyat", "türkçe", "turkce", "yazı", "yazi", "kitap", "okuma"), "open book pen writing desk"),
    (("üniversite", "universite", "tercih", "kampüs", "kampus", "meslek"), "university campus students walking"),
    (("yapay zeka", "teknoloji", "kod", "yazılım", "dijital"), "student using laptop technology class"),
    (("ders", "çalış", "calis", "ödev", "odev", "plan", "program"), "student studying books desk lamp"),
]
DEFAULT_STOCK_QUERY = "high school students studying classroom"


def default_stock_query(title: str) -> str:
    """Başlıktaki Türkçe anahtar kelimelerden ilgili bir İngilizce arama sorgusu üretir."""
    lowered = title.translate(TR_MAP).lower()
    for keywords, query in STOCK_QUERY_HINTS:
        if any(keyword in lowered for keyword in keywords):
            return query
    return DEFAULT_STOCK_QUERY


def format_license(item: Dict[str, Any]) -> str:
    license_id = str(item.get("license") or "").lower()
    version = str(item.get("license_version") or "").strip()
    if license_id in ("cc0", "zero"):
        return "CC0 (kamu malı)"
    if license_id.startswith("by"):
        return f"CC {license_id.upper()} {version}".strip()
    return (license_id or "lisans bilgisi yok").upper()


def stock_attribution(item: Dict[str, Any]) -> str:
    """CC lisanslarının gerektirdiği atıf satırını üretir."""
    creator = str(item.get("creator") or "").strip() or "bilinmeyen"
    provider = str(item.get("provider") or item.get("source") or "").strip()
    license_text = format_license(item)
    license_url = str(item.get("license_url") or "").strip()
    attribution = f"Fotoğraf: {creator}"
    if provider:
        attribution += f" / {provider}"
    attribution += f" — {license_text}"
    if license_url:
        attribution += f" ({license_url})"
    return attribution


def search_stock_images(query: str, license_type: str = "commercial", limit: int = 8) -> List[Dict[str, Any]]:
    """
    Openverse'te açık lisanslı görsel arar.

    Openverse zaman zaman 10+ saniyede yanıt verir ya da 5xx döner; bu yüzden her
    parametre varyantı için kısa aralıklarla üç deneme yapılır.
    """
    base_params = {
        "q": query,
        "license_type": license_type,
        "page_size": str(limit),
        "mature": "false",
    }
    last_error: Optional[str] = None
    any_success = False
    collected: List[Dict[str, Any]] = []
    seen: set = set()
    for extra in ({"size": "large"}, {}):
        url = f"{OPENVERSE_SEARCH_URL}?{urllib.parse.urlencode({**base_params, **extra})}"
        payload: Optional[Dict[str, Any]] = None
        for attempt in range(3):
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            try:
                with urllib.request.urlopen(req, timeout=90) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                break
            except urllib.error.HTTPError as err:
                detail = err.read().decode("utf-8", "replace")[:160]
                last_error = f"Openverse araması başarısız → {err.code}: {detail}"
                if err.code not in (429, 500, 502, 503, 504) or attempt == 2:
                    break
            except urllib.error.URLError as err:
                last_error = f"Openverse aramasına ulaşılamadı: {err.reason}"
                if attempt == 2:
                    break
            time.sleep(2 * (attempt + 1))

        if payload is None:
            continue
        any_success = True
        last_error = None
        for item in payload.get("results") or []:
            if not item.get("url"):
                continue
            key = item.get("id") or item.get("url")
            if key in seen:
                continue
            seen.add(key)
            collected.append(item)
        if len(collected) >= MIN_STOCK_CANDIDATES:
            break

    # Arama en az bir kez başarılı olduysa boş sonuç hata değildir.
    if not collected and last_error and not any_success:
        raise RuntimeError(last_error)
    return collected[:limit]


def download_stock_image(candidates: List[Dict[str, Any]]) -> Tuple[bytes, str, Dict[str, Any]]:
    """Aday görselleri sırayla indirir; indirilebilen ilk uygun görseli döner.

    Kaynağın kendi adresi hız sınırı verirse (örn. Wikimedia 429) Openverse'ün
    thumbnail vekiline düşülür.
    """
    errors: List[str] = []
    for item in candidates:
        for url in (item.get("url"), item.get("thumbnail")):
            if not url:
                continue
            try:
                raw = download_bytes(url)
            except Exception as err:  # noqa: BLE001 - tek adayın hatası aramayı durdurmasın
                errors.append(f"{url} → {err}")
                continue
            if not (MIN_IMAGE_BYTES <= len(raw) <= MAX_IMAGE_BYTES):
                errors.append(f"{url} → boyut uygun değil ({len(raw)} bayt)")
                continue
            mime = guess_mime(url, raw)
            if not mime.startswith("image/"):
                errors.append(f"{url} → görsel olmayan içerik ({mime})")
                continue
            return raw, mime, item
    raise RuntimeError("Hiçbir açık lisanslı görsel indirilemedi:\n  " + "\n  ".join(errors[:5]))


def ext_from_mime(mime: str) -> str:
    return mimetypes.guess_extension(mime.split(";")[0]) or ".png"


# ─── SEO ─────────────────────────────────────────────────────────────────────

def build_seo(
    title: str,
    plain_text: str,
    headings: List[str],
    category: Optional[str],
    meta: Dict[str, Any],
) -> Dict[str, Any]:
    """Verilmeyen SEO alanlarını başlık ve içerikten üretir."""
    meta_title = str(meta.get("metaTitle") or "").strip()
    if not meta_title:
        candidate = f"{title} | {SITE_NAME}"
        meta_title = candidate if len(candidate) <= 60 else truncate(f"{title} | {SITE_NAME}", 60)

    meta_description = str(meta.get("metaDescription") or "").strip()
    if not meta_description:
        source = plain_text or f"{title} hakkında {SITE_NAME} blog yazısı."
        if category:
            source = f"{source} ({category})"
        meta_description = truncate(source, 155)

    keywords = str(meta.get("keywords") or "").strip()
    if not keywords:
        seed = [title, *(headings[:4]), category or "", SITE_NAME, "blog"]
        seen: List[str] = []
        for item in seed:
            item = (item or "").strip()
            if item and item.lower() not in [s.lower() for s in seen]:
                seen.append(item)
        keywords = ", ".join(seen)

    seo: Dict[str, Any] = {"metaTitle": meta_title, "metaDescription": meta_description, "keywords": keywords}
    return seo


def collect_headings(blocks: List[Dict[str, Any]]) -> List[str]:
    headings: List[str] = []
    for block in blocks:
        if block.get("type") == "heading":
            headings.append(blocks_plain_text([block]))
    return headings


# ─── Ana Akış ────────────────────────────────────────────────────────────────

def read_markdown(args: argparse.Namespace) -> Tuple[Dict[str, Any], str, Path]:
    """Markdown dosyası veya --title/--body argümanlarından (ön bilgi, gövde, temel dizin) üretir."""
    if args.markdown_file:
        path = Path(args.markdown_file)
        if not path.is_file():
            raise RuntimeError(f"Markdown dosyası bulunamadı: {path}")
        raw = path.read_text(encoding="utf-8")
        meta, body = parse_frontmatter(raw)
        return meta, body, path.parent

    body = ""
    if args.body_file:
        body_path = Path(args.body_file)
        if not body_path.is_file():
            raise RuntimeError(f"Gövde dosyası bulunamadı: {body_path}")
        raw = body_path.read_text(encoding="utf-8")
        meta_from_file, body = parse_frontmatter(raw)
    elif args.body:
        meta_from_file, body = parse_frontmatter(args.body)
    else:
        raise RuntimeError("Markdown dosyası, --body-file veya --body belirtilmelidir.")
    return meta_from_file, body, Path.cwd()


def resolve_cover(
    meta: Dict[str, Any],
    args: argparse.Namespace,
    base_dir: Path,
    strapi: Optional[StrapiClient],
    title: str,
    slug: str,
    dry_run: bool = False,
) -> Tuple[Optional[Dict[str, Any]], List[str]]:
    """
    Kapak görselini hazırlar. Öncelik sırası:
      1. --image / image: (yerel dosya, URL veya medya kütüphanesindeki mevcut dosya)
      2. --stock-image / imageQuery: (Openverse'te açık lisanslı arama)
      3. --ai-image / aiImage: (AI ile üretim, OPENAI_API_KEY gerekir)
      Hiçbiri verilmezse 2. adım başlıktan üretilen sorguyla otomatik çalışır.
    """
    notes: List[str] = []
    if args.no_image:
        return None, notes

    image_dir = Path(args.image_dir) if args.image_dir else default_image_dir(base_dir)
    source = args.image or str(meta.get("image") or "").strip()

    # Daha önce indirilen/üretilen görsel duruyorsa yeniden arama yapma.
    # --stock-image veya --ai-image komut satırından verildiyse yeni görsel isteniyordur.
    cached = find_cached_cover(image_dir, slug)
    if cached and not source and args.stock_image is None and args.ai_image is None:
        notes.append(f"♻️ Hazır görsel kullanılıyor, yeni arama yapılmadı: {cached}")
        if strapi is not None:
            already_uploaded = strapi.find_file_by_name(slug)
            if already_uploaded:
                notes.append(f"♻️ Medya kütüphanesinde de mevcut: {already_uploaded.get('url')}")
                return normalize_media(already_uploaded), notes
        source = str(cached.resolve())

    stock_query = args.stock_image
    if stock_query is None:
        stock_query = str(meta.get("imageQuery") or "").strip() or None
    ai_prompt = args.ai_image
    if ai_prompt is None:
        ai_prompt = str(meta.get("aiImage") or "").strip() or None
    if ai_prompt == "":
        ai_prompt = (
            f'{SITE_NAME} eğitim blogu kapak görseli: "{title}". '
            "Modern, sade, motive edici illüstrasyon; pastel renkler; üzerinde metin yok."
        )

    alt = args.image_alt or str(meta.get("imageAlt") or "").strip() or title
    caption = str(meta.get("imageCaption") or "").strip()

    # Görsel kaynağı belirtilmediyse açık lisanslı arama varsayılan davranıştır
    if not source and stock_query is None and not ai_prompt:
        stock_query = ""

    # ── 2) Açık lisanslı görsel ara ──
    if stock_query is not None and not source:
        query = stock_query or default_stock_query(title)
        notes.append(f"🔎 Açık lisanslı görsel aranıyor: \"{query}\"")
        try:
            candidates = search_stock_images(query, license_type=args.stock_license)
        except RuntimeError as err:
            notes.append(f"⚠️  {err}")
            candidates = []
        if not candidates:
            notes.append("⚠️  Uygun açık lisanslı görsel bulunamadı, kapaksız devam ediliyor.")
        else:
            chosen = candidates[0]
            attribution = stock_attribution(chosen)
            notes.append(f"   🖼  \"{truncate(str(chosen.get('title') or query), 70)}\" · {format_license(chosen)}")
            notes.append(f"   👤 {attribution}")
            notes.append(f"   🔗 {chosen.get('foreign_landing_url') or chosen.get('url')}")
            if dry_run or strapi is None:
                notes.append("   ⚠️  --dry-run: görsel indirilmedi ve yüklenmedi.")
                return None, notes
            try:
                raw, mime, chosen = download_stock_image(candidates)
            except RuntimeError as err:
                notes.append(f"⚠️  {err}")
                return None, notes
            attribution = stock_attribution(chosen)
            saved = save_local_image(image_dir, slug, raw, mime)
            if saved:
                notes.append(f"   💾 Yerel kopya kaydedildi: {saved}")
            filename = f"{slug}{ext_from_mime(mime)}"
            file_object = strapi.upload(
                filename, raw, mime, alt=alt, caption=caption or attribution
            )
            notes.append(f"   ✅ Yüklendi: {file_object.get('url')}")
            notes.append(f"   📎 Atıf caption olarak kaydedildi → {attribution}")
            return file_object, notes

    # ── 3) AI ile üret ──
    if ai_prompt and not source:
        if dry_run or strapi is None:
            notes.append("⚠️  --dry-run: AI görseli üretilmedi.")
            return None, notes
        notes.append(f"🎨 AI görseli üretiliyor: {truncate(ai_prompt, 90)}")
        raw, mime = generate_ai_image(ai_prompt, size=args.ai_image_size)
        saved = save_local_image(image_dir, slug, raw, mime)
        if saved:
            notes.append(f"💾 Yerel kopya kaydedildi: {saved}")
        file_object = strapi.upload(f"{slug}{ext_from_mime(mime)}", raw, mime, alt=alt, caption=caption)
        notes.append(f"✅ Kapak görseli yüklendi: {file_object.get('url')}")
        return file_object, notes

    # ── 1) Yerel dosya / URL / medya kütüphanesi ──
    if not source:
        return None, notes

    existing = None
    if strapi is not None and source.startswith(
        ("/uploads/", strapi.base_url, "http://", "https://")
    ):
        relative = source.replace(strapi.base_url, "")
        if not relative.startswith("/uploads/"):
            relative = urllib.parse.urlparse(relative).path
        existing = strapi.find_file_by_url(relative)
    if existing:
        notes.append(f"♻️  Medya kütüphanesindeki mevcut görsel kullanılıyor: {existing.get('url')}")
        return existing, notes

    if dry_run or strapi is None:
        notes.append("⚠️  --dry-run: görsel yüklenmedi, kapak atlandı.")
        return None, notes

    raw, mime, filename = load_image_source(source, base_dir)
    if source.startswith(("http://", "https://")):
        saved = save_local_image(image_dir, slug, raw, mime)
        if saved:
            notes.append(f"💾 Yerel kopya kaydedildi: {saved}")
    notes.append(f"🖼️  Görsel yükleniyor: {filename}")
    file_object = strapi.upload(ascii_filename(filename, slug), raw, mime, alt=alt, caption=caption)
    notes.append(f"✅ Kapak görseli yüklendi: {file_object.get('url')}")
    return file_object, notes


def resolve_inline_image(
    src: str,
    alt: str,
    base_dir: Path,
    strapi: Optional[StrapiClient],
    cache: Dict[str, Dict[str, Any]],
    warnings: List[str],
    dry_run: bool = False,
) -> Optional[Dict[str, Any]]:
    """İçerikteki ![alt](kaynak) görsellerini yükler ve tam dosya nesnesini döner."""
    if src in cache:
        return cache[src]

    if dry_run or strapi is None:
        warnings.append(f"--dry-run: görsel yüklenmedi → {src}")
        return None

    try:
        if src.startswith("/uploads/"):
            found = strapi.find_file_by_url(src)
            if found:
                cache[src] = normalize_media(found)
                return cache[src]
        raw, mime, filename = load_image_source(src, base_dir)
        file_object = normalize_media(strapi.upload(filename, raw, mime, alt=alt))
        print(f"  🖼️  İçerik görseli yüklendi: {file_object.get('url')}")
        cache[src] = file_object
        return file_object
    except Exception as err:  # noqa: BLE001 - görsel hatası yazıyı durdurmasın
        warnings.append(f"Görsel yüklenemedi ({src}): {err}")
        return None


def print_outline(blocks: List[Dict[str, Any]]) -> None:
    """Blokların okunabilir özetini yazdırır."""
    icons = {
        "heading": "H",
        "paragraph": "¶",
        "list": "≡",
        "quote": "❝",
        "code": "</>",
        "image": "🖼",
    }
    for block in blocks:
        kind = block.get("type", "?")
        if kind == "heading":
            print(f"  {icons[kind]}{block.get('level')} {blocks_plain_text([block])}")
        elif kind == "list":
            ordered = block.get("format") == "ordered"
            items = [c for c in block.get("children", []) if c.get("type") == "list-item"]
            print(f"  {icons[kind]} {'sıralı' if ordered else 'maddeli'} liste ({len(items)} madde)")
        elif kind == "image":
            image = block.get("image") or {}
            print(f"  {icons[kind]} görsel → {image.get('url') or image.get('name') or 'yüklenmedi'}")
        elif kind == "code":
            print(f"  {icons[kind]} kod ({block.get('syntax') or 'düz'})")
        else:
            print(f"  {icons.get(kind, '•')} {truncate(blocks_plain_text([block]), 90)}")


def resolve_page(strapi: Optional[StrapiClient], page_slug: str) -> Optional[str]:
    if not page_slug or strapi is None:
        return None
    for status in ("published", "draft"):
        page = strapi.find_one("pages", "slug", page_slug, status=status)
        if page and page.get("documentId"):
            return page["documentId"]
    raise RuntimeError(
        f'"{page_slug}" slug\'ına sahip Page bulunamadı. Mevcut sayfalar: {list_page_slugs(strapi)}'
    )


def list_page_slugs(strapi: Optional[StrapiClient]) -> str:
    """Hata mesajlarında göstermek için mevcut Page slug'larını döndürür."""
    if strapi is None:
        return "(bilinmiyor)"
    slugs = []
    for status in ("published", "draft"):
        try:
            res = strapi.request(f"pages?status={status}&pagination[pageSize]=100&fields[0]=slug")
        except Exception:
            continue
        for item in res.get("data", []):
            if item.get("slug") and item["slug"] not in slugs:
                slugs.append(item["slug"])
        if slugs:
            break
    return ", ".join(slugs) if slugs else "(yok)"


def fetch_published_at(strapi: "StrapiClient", document_id: str) -> Optional[str]:
    """Yazının yayınlanmış sürümü varsa publishedAt değerini döndürür."""
    try:
        res = strapi.request(f"blogs/{document_id}?status=published")
    except Exception:
        return None
    return (res.get("data") or {}).get("publishedAt")


def main() -> None:
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="Markdown içeriği Strapi blog yazısına (blocks + SEO + görsel) dönüştürüp yükler.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("markdown_file", nargs="?", default=None, help="Ön bilgi bloğu içerebilen markdown dosyası")
    parser.add_argument("--title", help="Yazı başlığı")
    parser.add_argument("--body", help="Markdown gövde metni (dosya yerine)")
    parser.add_argument("--body-file", help="Markdown gövde dosyası")
    parser.add_argument("--slug", help="URL slug'ı (varsayılan: başlıktan üretilir)")
    parser.add_argument("--category", choices=CATEGORIES, help="Blog kategorisi")
    parser.add_argument("--page", help="İlişkilendirilecek Page slug'ı (örn: bloglar)")
    parser.add_argument("--popular", action="store_true", default=False, help="isPopular = true yapar")
    parser.add_argument("--image", help="Kapak görseli: yerel dosya yolu veya http(s) URL")
    parser.add_argument("--image-alt", help="Kapak görseli alt metni")
    parser.add_argument(
        "--ai-image",
        nargs="?",
        const="",
        default=None,
        metavar="PROMPT",
        help="Kapak görselini AI ile üret (OPENAI_API_KEY gerekir). Prompt verilmezse başlıktan üretilir.",
    )
    parser.add_argument("--ai-image-size", default="1536x1024", help="AI görsel boyutu (varsayılan: 1536x1024)")
    parser.add_argument(
        "--stock-image",
        nargs="?",
        const="",
        default=None,
        metavar="SORGU",
        help="Openverse'te açık lisanslı (ücretsiz kullanılabilir) görsel ara. Sorgu verilmezse başlıktan üretilir.",
    )
    parser.add_argument(
        "--stock-license",
        default="commercial",
        choices=["commercial", "modification", "all-cc", "all"],
        help="Açık lisans filtresi (varsayılan: commercial — ticari kullanıma uygun)",
    )
    parser.add_argument(
        "--no-image",
        action="store_true",
        default=False,
        help="Kapak görseli arama/üretme (--update ile mevcut kapak bloğu da kaldırılır)",
    )
    parser.add_argument(
        "--image-dir",
        default=None,
        help=(
            "Web'den bulunan/üretilen kapak görsellerinin kaydedileceği klasör "
            f"(varsayılan: {DEFAULT_IMAGE_DIR})"
        ),
    )
    parser.add_argument("--meta-title", help="SEO metaTitle (verilmezse üretilir)")
    parser.add_argument("--meta-description", help="SEO metaDescription (verilmezse üretilir)")
    parser.add_argument("--keywords", help="SEO keywords (virgülle ayrılmış)")
    parser.add_argument("--update", action="store_true", default=False, help="Aynı slug varsa güncelle")
    parser.add_argument("--draft", action="store_true", default=False, help="Yayınlama, taslak bırak")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Strapi'ye yazmadan dönüştürmeyi göster")
    parser.add_argument("--save-json", help="Üretilen payload'ı JSON olarak kaydet")
    parser.add_argument(
        "--strapi-url",
        default=os.environ.get("STRAPI_URL") or DEFAULT_STRAPI_URL,
        help=f"Strapi adresi (varsayılan: STRAPI_URL env, o da yoksa {DEFAULT_STRAPI_URL})",
    )
    parser.add_argument(
        "--strapi-token",
        default=os.environ.get("STRAPI_TOKEN"),
        help="Strapi API Token (varsayılan: STRAPI_TOKEN env)",
    )

    args = parser.parse_args()

    if not args.markdown_file and not args.title and not args.body and not args.body_file:
        parser.print_help()
        print("\nHATA: bir markdown dosyası ya da --title/--body(-file) vermelisiniz.", file=sys.stderr)
        sys.exit(1)

    try:
        meta, body, base_dir = read_markdown(args)
    except RuntimeError as err:
        print(f"HATA: {err}", file=sys.stderr)
        sys.exit(1)

    # CLI argümanları ön bilgi bloğunu ezer
    for key, value in (
        ("title", args.title),
        ("slug", args.slug),
        ("category", args.category),
        ("page", args.page),
        ("image", args.image),
        ("imageAlt", args.image_alt),
        ("metaTitle", args.meta_title),
        ("metaDescription", args.meta_description),
        ("keywords", args.keywords),
    ):
        if value:
            meta[key] = value
    if args.popular:
        meta["isPopular"] = True

    title = str(meta.get("title") or "").strip()
    if not title:
        print("HATA: title belirtilmelidir (ön bilgi bloğunda veya --title ile).", file=sys.stderr)
        sys.exit(1)

    category = str(meta.get("category") or "").strip() or None
    if category and category not in CATEGORIES:
        print(f"HATA: geçersiz kategori '{category}'. Seçenekler: {', '.join(CATEGORIES)}", file=sys.stderr)
        sys.exit(1)

    slug = slugify(str(meta.get("slug") or title))

    dry_run = args.dry_run
    strapi_url = (args.strapi_url or DEFAULT_STRAPI_URL).rstrip("/")
    is_local = any(host in strapi_url for host in ("localhost", "127.0.0.1"))
    print(f"🎯 Hedef  : {strapi_url}{'  (yerel)' if is_local else '  ← CANLI ORTAM'}")
    if not args.strapi_token:
        if not dry_run:
            print(
                "HATA: STRAPI_TOKEN tanımlanmalıdır "
                "($env:STRAPI_TOKEN, .env dosyası veya --strapi-token ile).",
                file=sys.stderr,
            )
            sys.exit(1)
        print("   Token yok → --dry-run yalnızca yerel dönüştürme yapar.")
    strapi: Optional[StrapiClient] = (
        StrapiClient(strapi_url, args.strapi_token) if args.strapi_token else None
    )

    print(f"📝 Başlık : {title}")
    print(f"🔗 Slug   : {slug}")
    if category:
        print(f"🏷️  Kategori: {category}")
    print()

    # 1. Kapak görseli
    try:
        cover, cover_notes = resolve_cover(meta, args, base_dir, strapi, title, slug, dry_run=dry_run)
    except RuntimeError as err:
        print(f"HATA: {err}", file=sys.stderr)
        sys.exit(1)
    for note in cover_notes:
        print(note)
    if cover:
        cover = normalize_media(cover)

    # 2. Gövde → blocks
    image_cache: Dict[str, Dict[str, Any]] = {}
    inline_warnings: List[str] = []

    def resolve_image(src: str, alt: str) -> Optional[Dict[str, Any]]:
        return resolve_inline_image(src, alt, base_dir, strapi, image_cache, inline_warnings, dry_run=dry_run)

    blocks, warnings = markdown_to_blocks(body, resolve_image=resolve_image)

    # Kapak görseli içeriğin başında da gösterilsin (içerikte yoksa)
    if cover and not any(b.get("type") == "image" for b in blocks):
        blocks.insert(0, {"type": "image", "image": cover, "children": [text_node("")]})

    for warning in warnings + inline_warnings:
        print(f"⚠️  {warning}")

    plain_text = blocks_plain_text(blocks)
    seo = build_seo(title, plain_text, collect_headings(blocks), category, meta)
    if cover:
        seo["metaImage"] = cover["id"]

    data: Dict[str, Any] = {
        "title": title,
        "slug": slug,
        "content": blocks,
        "isPopular": bool(meta.get("isPopular", False)),
        "SEO": seo,
    }
    if category:
        data["category"] = category
    if cover:
        data["image"] = cover["id"]

    if meta.get("page"):
        try:
            page_document_id = resolve_page(strapi, str(meta["page"]))
        except RuntimeError as err:
            print(f"⚠️  {err}")
            print("   Page ilişkisi olmadan kaydedilecek; bu yazı hiçbir sayfa listesinde görünmez.")
            page_document_id = None
        if page_document_id:
            data["page"] = page_document_id

    print(f"\n🧱 {len(blocks)} blok oluşturuldu:")
    print_outline(blocks)

    print("\n🔎 SEO:")
    print(f"  metaTitle       : {seo['metaTitle']} ({len(seo['metaTitle'])} karakter)")
    print(f"  metaDescription : {seo['metaDescription']} ({len(seo['metaDescription'])} karakter)")
    print(f"  keywords        : {seo['keywords']}")

    payload = {"data": data}

    if args.save_json:
        out_path = Path(args.save_json)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"\n💾 Payload kaydedildi: {out_path}")

    # 3. Oluştur veya güncelle
    existing = strapi.find_one("blogs", "slug", slug, status="draft") if strapi else None

    if dry_run:
        if existing:
            print(f"\nℹ️  '{slug}' zaten var (documentId={existing['documentId']}) → --update ile güncellenir.")
        elif strapi:
            print(f"\nℹ️  '{slug}' bulunamadı → yeni yazı oluşturulur.")
        print("🏁 --dry-run: Strapi'ye hiçbir şey yazılmadı.")
        return

    if existing and not args.update:
        print(
            f"\nHATA: '{slug}' slug'ında bir yazı zaten var (documentId={existing['documentId']}). "
            "Güncellemek için --update kullanın.",
            file=sys.stderr,
        )
        sys.exit(1)

    # status parametresi yazının hangi sürümüne yazılacağını belirler:
    # "published" hem taslağı günceller hem de anında yayınlar.
    status_param = "?status=draft" if args.draft else "?status=published"
    if existing:
        document_id = existing["documentId"]
        strapi.request(f"blogs/{document_id}{status_param}", method="PUT", data=payload)
        print(f"\n✏️  Yazı güncellendi: {document_id}")
    else:
        created = strapi.request(f"blogs{status_param}", method="POST", data=payload)
        document_id = (created.get("data") or {}).get("documentId")
        if not document_id:
            print(f"HATA: beklenmeyen oluşturma yanıtı: {json.dumps(created)[:400]}", file=sys.stderr)
            sys.exit(1)
        print(f"\n✅ Yazı oluşturuldu: {document_id}")

    # 4. Yayın durumunu doğrula
    admin_url = f"{strapi_url}/admin/content-manager/collection-types/api::blog.blog/{document_id}"
    if args.draft:
        print("📄 Taslak olarak kaydedildi (yayınlanmadı).")
    else:
        published_at = fetch_published_at(strapi, document_id)
        if published_at:
            print(f"🚀 Yayında (publishedAt={published_at}).")
        else:
            print("⚠️  Kaydedildi ama yayınlanmadı — token'ın publish yetkisi olmayabilir.")

    print(f"\n🔗 {admin_url}")


if __name__ == "__main__":
    main()
