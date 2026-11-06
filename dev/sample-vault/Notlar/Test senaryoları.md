---
xwiki-title: Test senaryoları (özel başlık)
---

# Test senaryoları

| Not | Test ettiği özellik |
| --- | --- |
| `Projeler/Projeler.md` | Klasörün içindeki folder note, klasör sayfası olarak publish edilir |
| `Projeler/Alfa/Alfa.md` | İç içe folder note, resim eki ve not linkleri |
| `Projeler/Alfa/Gereksinimler.md` | Boş hücreli tablo, görev listesi, kod bloğu |
| `Projeler/Beta/Plan.md` | Folder note'u olmayan klasör: boş klasör sayfası oluşturulur |
| `Projeler/Beta/Plan (XWiki conflict).md` | Conflict kopyası: klasör publish'te atlanmalı |
| `Ekip/Ekip.md`, `Ekip/Toplantılar/…` | İkinci bir klasör ağacı |
| `Notlar/Özel alan.md` | `xwiki-space` ile hedef alanın değiştirilmesi |
| Bu not | `xwiki-title` ile sayfa başlığının değiştirilmesi |
| Herhangi bir not | OpenProject linki ekleyip publish edin: bağlantı eklenir; tekrar publish edin: mükerrer eklenmez; linki silip publish edin: bağlantı kaldırılır. Sonuçlar *Recent activity* listesinde görünür. |

Varsayılan XWiki alanı kurulum script'inde `ObsidianTest` olarak ayarlanır; tüm sayfalar bu alanın altına gider.
