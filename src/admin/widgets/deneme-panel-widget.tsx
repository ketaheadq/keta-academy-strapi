import { Box, Flex, Typography } from "@strapi/design-system";
import { useFetchClient } from "@strapi/strapi/admin";
import { useEffect, useState } from "react";

type Talep = {
	documentId: string;
	adSoyad: string;
	telefon: string;
	yakinlik: string;
	durum: string;
	raporAcilmaSayisi: number;
	denemeBaslik: string;
	net: number;
	zayifKonular: string | null;
	raporLinki: string;
	aramaIzni: boolean;
	kaynak: string | null;
	createdAt: string;
};
type PanelData = {
	talepler: Talep[];
	aranacak: number;
	yorumsuz: number;
	konusuzVideolar: { documentId: string; title: string }[];
	konusuzVideoSayisi: number;
};

const editUrl = (uid: string, documentId: string) => `/admin/content-manager/collection-types/${uid}/${documentId}`;
const linkStyle = { color: "#4945ff", textDecoration: "underline" };
const DURUM: Record<string, string> = {
	Aranacak: "Aranacak",
	Arandi: "Arandı",
	Ulasilamadi: "Ulaşılamadı",
	Gorusme_yapildi: "Görüşme yapıldı",
	Paket_aldi: "Paket aldı",
	Uygun_degil: "Uygun değil",
};
export const DenemePanelWidget = () => {
	const { get } = useFetchClient();
	const [data, setData] = useState<PanelData | null>(null);
	const [error, setError] = useState(false);

	useEffect(() => {
		get("/admin/deneme-panel")
			.then((response: { data: { data: PanelData } }) => setData(response.data.data))
			.catch(() => setError(true));
	}, [get]);

	if (error) return <Typography textColor="danger600">Panel verisi yüklenemedi.</Typography>;
	if (!data) return <Typography textColor="neutral600">Yükleniyor…</Typography>;

	return (
		<Flex direction="column" alignItems="stretch" gap={4}>
			<Flex gap={4}>
				<Typography variant="omega">
					<strong>{data.aranacak}</strong> aranacak
				</Typography>
				<Typography variant="omega">
					<strong>{data.yorumsuz}</strong> rapor yapay zeka yorumu olmadan açılıyor
				</Typography>
				<a style={linkStyle} href="/admin/content-manager/collection-types/api::rapor-talebi.rapor-talebi">
					Tüm talepler
				</a>
			</Flex>

			<Box>
				<Typography variant="sigma" textColor="neutral600">
					Son talepler
				</Typography>
				{data.talepler.length === 0 && (
					<Typography tag="p" textColor="neutral600">
						Henüz rapor talebi yok.
					</Typography>
				)}
				{data.talepler.map((t) => (
					<Box key={t.documentId} paddingTop={2} paddingBottom={2} borderColor="neutral150" style={{ borderBottom: "1px solid" }}>
						<Flex justifyContent="space-between" gap={2} wrap="wrap">
							<Typography fontWeight="bold">
								{t.adSoyad} ({t.yakinlik === "Ogrenci" ? "Öğrenci" : t.yakinlik === "Diger" ? "Diğer" : "Veli"}) · 0{t.telefon}
							</Typography>
							<Typography variant="pi" textColor="neutral600">
								{DURUM[t.durum] ?? t.durum} · {t.raporAcilmaSayisi ? `rapor ${t.raporAcilmaSayisi} kez açıldı` : "rapor açılmadı"}
								{t.aramaIzni ? "" : " · arama izni yok"}
							</Typography>
						</Flex>
						<Typography variant="pi" tag="p">
							{t.denemeBaslik} — net {t.net}
							{t.zayifKonular ? ` — zayıf: ${t.zayifKonular}` : ""}
							{t.kaynak ? ` — kaynak: ${t.kaynak}` : ""}
						</Typography>
						<Flex gap={3}>
							<a style={linkStyle} href={`${t.raporLinki}?onizleme=1`} target="_blank" rel="noreferrer">
								Raporu aç
							</a>
							<a style={linkStyle} href={editUrl("api::rapor-talebi.rapor-talebi", t.documentId)}>
								Kaydı aç (not)
							</a>
						</Flex>
					</Box>
				))}
			</Box>

			<Box>
				<Typography variant="sigma" textColor="neutral600">
					Konusu atanmamış ders videoları ({data.konusuzVideoSayisi})
				</Typography>
				<Typography variant="pi" tag="p" textColor="neutral600">
					Raporlar video önerirken Konu kaydındaki "Ders videoları" listesini kullanır.
				</Typography>
				{data.konusuzVideolar.map((l) => (
					<Box key={l.documentId} paddingTop={1}>
						<a style={linkStyle} href={editUrl("api::lesson.lesson", l.documentId)}>
							{l.title}
						</a>
					</Box>
				))}
			</Box>
		</Flex>
	);
};
