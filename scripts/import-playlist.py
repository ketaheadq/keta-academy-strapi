# -*- coding: utf-8 -*-
"""
Tek adımda YouTube çalma listesindeki videoları Strapi kursuna ders olarak yükler.
yt-dlp + metadata/SEO üretimi + Strapi API yüklemesini tek bir dosyada birleştirir.

Kullanım:
  # 1. Ortam değişkenleriyle doğrudan çalma listesi yükleme:
  STRAPI_URL=https://admin.ketalearn.cloud STRAPI_TOKEN=xxx python scripts/import-playlist.py \
      --course 8-sinif-matematik \
      --playlist "https://www.youtube.com/playlist?list=PL..."

  # 2. Hem Strapi'ye yükleyip hem de CSV yedeği almak için:
  python scripts/import-playlist.py \
      --course 8-sinif-matematik \
      --playlist "https://www.youtube.com/playlist?list=PL..." \
      --save-csv dersler.csv

  # 3. Yüklemeden önce önizleme (dry-run):
  python scripts/import-playlist.py \
      --course 8-sinif-matematik \
      --playlist "https://www.youtube.com/playlist?list=PL..." \
      --dry-run

  # 4. Taslak olarak ekleme:
  python scripts/import-playlist.py \
      --course 8-sinif-matematik \
      --playlist "https://www.youtube.com/playlist?list=PL..." \
      --draft
"""

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

try:
    import yt_dlp
except ImportError:
    print("HATA: 'yt-dlp' paketi yüklü değil. Yüklemek için: pip install yt-dlp", file=sys.stderr)
    sys.exit(1)

SITE_NAME = "KetaLearn"


# ─── .env ve Ortam Değişkenleri ──────────────────────────────────────────────

def load_dotenv():
    """Çalışma dizini veya üst dizinlerdeki .env dosyasını ortam değişkenlerine ekler."""
    search_dirs = [Path.cwd(), Path.cwd().parent, Path(__file__).resolve().parent.parent, Path(__file__).resolve().parent.parent.parent]
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


# ─── Metin ve Slug Yardımcıları ─────────────────────────────────────────────

def slugify(text: str) -> str:
    """Türkçe karakterleri dönüştürerek URL uyumlu slug üretir."""
    tr_map = str.maketrans({
        "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u",
        "Ç": "c", "Ğ": "g", "I": "i", "İ": "i", "Ö": "o", "Ş": "s", "Ü": "u"
    })
    text = text.translate(tr_map).lower()
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def truncate(text: str, max_len: number = 155) -> str:
    """Metni kelime sınırından keser."""
    clean = re.sub(r"\s+", " ", text).strip()
    if len(clean) <= max_len:
        return clean
    cut = clean[: max_len - 1]
    last_space = cut.rfind(" ")
    split_point = last_space if last_space >= max_len // 2 else max_len - 1
    return cut[:split_point].strip() + "…"


def clean_youtube_title(title: str) -> str:
    """
    YouTube başlıklarındaki sıra numarası, sınıf/ders adı, öğretmen adı veya yıl
    gibi gereksiz kalıpları temizleyerek sadece konu adını bırakır.
    Örnek: '1) 8.Sınıf - Matematik - Çarpan Kavramı - Yavuz KABUL - 2026' -> 'Çarpan Kavramı'
    """
    t = title.strip()
    # 1. Sıra numarası: '1) ', '12) ', '#1 ', '1. ' (8. Sınıf hariç)
    t = re.sub(r"^\s*(?:\d+[\)]|\d+\.(?!\s*sınıf)|\#\d+)\s*", "", t, flags=re.IGNORECASE)
    # 2. Sınıf ve ders ön eki: '8.Sınıf - Matematik -', '8. Sınıf -'
    t = re.sub(r"^\s*\d+\s*\.\s*Sınıf\s*[-–—:]?\s*(?:[A-Za-zÇĞİÖŞÜçğıöşü\s]+[-–—:])?\s*", "", t, flags=re.IGNORECASE)
    # 3. Öğretmen ve yıl son eki: '- Yavuz KABUL - 2026', '| Hoca', '- 2026'
    t = re.sub(r"\s*[-–—|]\s*(?:20\d\d|[A-Za-zÇĞİÖŞÜçğıöşü\s]+[-–—]\s*20\d\d|[A-Za-zÇĞİÖŞÜçğıöşü\s]+Hoca.*|Yavuz\s*KABUL.*|20\d\d.*)$", "", t, flags=re.IGNORECASE)
    t = re.sub(r"\s+", " ", t).strip(" -–—|")
    return t if t else title.strip()


def build_seo(title: str, course_title: str, description: str = "", meta_title: str = "", meta_desc: str = "", keywords: str = "") -> Dict[str, str]:
    """SEO metaTitle, metaDescription ve keywords alanlarını oluşturur."""
    with_site = f"{title} | {course_title} | {SITE_NAME}"
    m_title = meta_title or (with_site if len(with_site) <= 60 else truncate(f"{title} | {SITE_NAME}", 60))
    m_desc = truncate(
        meta_desc or description or f'{course_title} kursunda "{title}" dersini ücretsiz izle, ilerlemeni takip et ve quizlerle pekiştir.',
        155
    )
    kw = keywords or ", ".join([title, course_title, SITE_NAME, "ders videosu", "ücretsiz ders"])
    return {
        "metaTitle": m_title,
        "metaDescription": m_desc,
        "keywords": kw
    }


# ─── Strapi REST İstemcisi ───────────────────────────────────────────────────

class StrapiClient:
    def __init__(self, base_url: str, token: str):
        self.base_url = base_url.rstrip("/")
        self.token = token

    def request(self, path: str, method: str = "GET", data: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.base_url}/api/{path.lstrip('/')}"
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json"
        }
        body_bytes = json.dumps(data).encode("utf-8") if data is not None else None
        req = urllib.request.Request(url, data=body_bytes, headers=headers, method=method)

        try:
            with urllib.request.urlopen(req) as resp:
                status = resp.status
                resp_text = resp.read().decode("utf-8")
                return json.loads(resp_text) if resp_text else {}
        except urllib.error.HTTPError as err:
            err_body = err.read().decode("utf-8")
            raise RuntimeError(f"{method} /api/{path} → {err.code}: {err_body}")

    def find_one(self, collection: str, field: str, value: str) -> Optional[Dict[str, Any]]:
        encoded_val = urllib.parse.quote(value)
        path = f"{collection}?filters[{field}][$eq]={encoded_val}&status=draft&pagination[pageSize]=1"
        res = self.request(path)
        data = res.get("data", [])
        return data[0] if data else None


# ─── YouTube Çalma Listesi Çıkarma ──────────────────────────────────────────

def extract_playlist_videos(playlist_url: str, clean_titles: bool = True) -> List[Dict[str, str]]:
    """yt-dlp kullanarak çalma listesindeki tüm videoları çeker."""
    ydl_opts = {
        "extract_flat": True,
        "quiet": True,
        "extractor_args": {"youtube": {"lang": ["tr"]}},
    }
    videos = []
    print(f"🔍 YouTube çalma listesi taranıyor: {playlist_url}...")
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(playlist_url, download=False)
        entries = info.get("entries", [])
        for entry in entries:
            raw_title = entry.get("title") or ""
            video_url = entry.get("url") or ""
            if not video_url.startswith("http"):
                video_id = entry.get("id") or video_url
                video_url = f"https://www.youtube.com/watch?v={video_id}"

            title = clean_youtube_title(raw_title) if clean_titles else raw_title.strip()
            desc = entry.get("description") or ""

            videos.append({
                "raw_title": raw_title,
                "title": title,
                "url": video_url,
                "description": desc.split("\n\n")[0].strip() if desc else ""
            })
    print(f"🎬 Toplam {len(videos)} video bulundu.\n")
    return videos


def read_csv_videos(csv_path: str) -> List[Dict[str, str]]:
    """CSV dosyasından videoları okur."""
    videos = []
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = row.get("url") or row.get("link") or ""
            title = row.get("title") or row.get("baslik") or ""
            if not url or not title:
                continue
            videos.append({
                "raw_title": title,
                "title": title,
                "url": url,
                "description": row.get("description") or row.get("aciklama") or "",
                "metaTitle": row.get("metaTitle") or "",
                "metaDescription": row.get("metaDescription") or "",
                "keywords": row.get("keywords") or ""
            })
    return videos


# ─── Ana Yürütme Fonksiyonu ──────────────────────────────────────────────────

def main():
    load_dotenv()

    parser = argparse.ArgumentParser(
        description="YouTube çalma listesini doğrudan Strapi kursuna ders olarak yükler."
    )
    parser.add_argument("playlist_pos", nargs="?", default=None, help="YouTube çalma listesi URL'si (isteğe bağlı konumsal)")
    parser.add_argument("--course", required=True, help="Derslerin ekleneceği kursun slug'ı (örn: 8-sinif-matematik)")
    parser.add_argument("--playlist", help="YouTube çalma listesi URL'si")
    parser.add_argument("--csv", help="Alternatif olarak mevcut bir CSV dosyasından yükleme")
    parser.add_argument("--save-csv", help="Üretilen verileri CSV olarak diske kaydetme yolu")
    parser.add_argument("--draft", action="store_true", default=False, help="Dersleri taslak (draft) olarak oluşturur")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Strapi'ye yazmadan ne yapılacağını listeler")
    parser.add_argument("--keep-titles", action="store_true", default=False, help="YouTube başlıklarını temizlemeden orijinal tutar")
    parser.add_argument("--strapi-url", default=os.environ.get("STRAPI_URL"), help="Strapi adresi (varsayılan: STRAPI_URL env)")
    parser.add_argument("--strapi-token", default=os.environ.get("STRAPI_TOKEN"), help="Strapi API Token (varsayılan: STRAPI_TOKEN env)")

    args = parser.parse_args()

    playlist_url = args.playlist or args.playlist_pos
    if not playlist_url and not args.csv:
        print("HATA: Çalma listesi URL'si veya --csv <dosya> belirtilmelidir.", file=sys.stderr)
        sys.exit(1)

    if not args.strapi_url or not args.strapi_token:
        print("HATA: STRAPI_URL ve STRAPI_TOKEN tanımlanmalıdır (terminal ortamında, .env dosyasında veya parametre olarak).", file=sys.stderr)
        sys.exit(1)

    strapi = StrapiClient(args.strapi_url, args.strapi_token)

    # 1. Kursu bul
    course = strapi.find_one("courses", "slug", args.course)
    if not course:
        print(f'HATA: "{args.course}" slug\'ına sahip kurs Strapi\'de bulunamadı!', file=sys.stderr)
        sys.exit(1)

    course_title = course.get("title", args.course)
    course_id = course["documentId"]
    print(f"📚 Kurs: {course_title} ({course_id})\n")

    # 2. Kursa bağlı mevcut dersleri ve en yüksek sıra numarasını al
    linked_slugs: Set[str] = set()
    order = 0
    page = 1
    while True:
        path = (
            f"course-lessons?filters[course][documentId][$eq]={course_id}"
            f"&populate[lesson][fields][0]=slug"
            f"&pagination[page]={page}&pagination[pageSize]=100"
        )
        res = strapi.request(path)
        for link in res.get("data", []):
            order = max(order, link.get("order") or 0)
            lesson_rel = link.get("lesson")
            if lesson_rel and lesson_rel.get("slug"):
                linked_slugs.add(lesson_rel["slug"])

        page_count = res.get("meta", {}).get("pagination", {}).get("pageCount", 1)
        if page >= page_count:
            break
        page += 1

    # 3. Videoları listele (YouTube veya CSV)
    if playlist_url:
        videos = extract_playlist_videos(playlist_url, clean_titles=not args.keep_titles)
    else:
        videos = read_csv_videos(args.csv)

    # 4. İsteğe bağlı CSV kaydı
    if args.save_csv:
        csv_path = Path(args.save_csv)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(csv_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f, lineterminator="\n")
            writer.writerow(["url", "title", "description", "metaTitle", "metaDescription", "keywords"])
            for v in videos:
                seo = build_seo(
                    v["title"],
                    course_title,
                    description=v.get("description", ""),
                    meta_title=v.get("metaTitle", ""),
                    meta_desc=v.get("metaDescription", ""),
                    keywords=v.get("keywords", "")
                )
                writer.writerow([
                    v["url"],
                    v["title"],
                    v.get("description") or f'{course_title} ders anlatımı.',
                    seo["metaTitle"],
                    seo["metaDescription"],
                    seo["keywords"]
                ])
        print(f"💾 CSV dosyası kaydedildi: {args.save_csv}\n")

    # 5. Strapi'ye aktarım döngüsü
    stats = {"created": 0, "reused": 0, "skipped": 0, "failed": 0}

    for idx, v in enumerate(videos, start=1):
        title = v["title"]
        url = v["url"]
        label = f"#{idx} {title}"

        try:
            if not url or not title:
                raise ValueError("url ve title zorunlu")

            lesson_slug = f"{slugify(args.course)}-{slugify(title)}"

            # Zaten bu kursa bağlı mı?
            if lesson_slug in linked_slugs:
                stats["skipped"] += 1
                print(f"⏭  {label}: zaten bu kursta")
                continue

            # Strapi'de bu slug ile ders var mı?
            lesson = strapi.find_one("lessons", "slug", lesson_slug)
            if lesson:
                # Bağlantıyı kontrol et
                link_check = strapi.request(
                    f"course-lessons?filters[course][documentId][$eq]={course_id}"
                    f"&filters[lesson][documentId][$eq]={lesson['documentId']}&pagination[pageSize]=1"
                )
                if link_check.get("data"):
                    stats["skipped"] += 1
                    linked_slugs.add(lesson_slug)
                    print(f"⏭  {label}: zaten bu kursta")
                    continue

                stats["reused"] += 1
                print(f"🔗 {label}: mevcut ders bağlanıyor")
            else:
                # Başlık çakışması kontrolü
                title_taken = strapi.find_one("lessons", "title", title)
                final_title = f"{title} ({course_title})" if title_taken else title

                seo = build_seo(
                    title,
                    course_title,
                    description=v.get("description", ""),
                    meta_title=v.get("metaTitle", ""),
                    meta_desc=v.get("metaDescription", ""),
                    keywords=v.get("keywords", "")
                )

                lesson_data = {
                    "title": final_title,
                    "slug": lesson_slug,
                    "description": v.get("description") or f'{course_title} - {title} ders videosu.',
                    "videoURL": url,
                    "SEO": seo
                }

                if args.dry_run:
                    print(f"🧪 {label}: oluşturulacak → {final_title} ({lesson_slug})")
                    lesson = {"documentId": "(dry-run)"}
                else:
                    endpoint = "lessons?status=draft" if args.draft else "lessons"
                    created_resp = strapi.request(endpoint, method="POST", data={"data": lesson_data})
                    lesson = created_resp.get("data", {})
                    extra_note = f' ("{final_title}")' if final_title != title else ""
                    print(f"✅ {label}: ders oluşturuldu{extra_note}")

                stats["created"] += 1

            # Kurs-Ders bağlantısını oluştur (order += 10)
            order += 10
            if not args.dry_run:
                strapi.request("course-lessons", method="POST", data={
                    "data": {
                        "course": course_id,
                        "lesson": lesson["documentId"],
                        "order": order
                    }
                })

            linked_slugs.add(lesson_slug)

        except Exception as e:
            stats["failed"] += 1
            print(f"❌ {label}: {e}", file=sys.stderr)

    print(
        f"\n{'[dry-run] ' if args.dry_run else ''}Bitti: "
        f"{stats['created']} oluşturuldu, {stats['reused']} mevcut ders bağlandı, "
        f"{stats['skipped']} atlandı, {stats['failed']} hata."
    )
    if stats["failed"]:
        sys.exit(1)


if __name__ == "__main__":
    main()
