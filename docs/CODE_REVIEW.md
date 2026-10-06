# Kod inceleme raporu (yayın öncesi)

İnceleme, yayın öncesinde kaynak kodun tamamı (`src/`, `styles.css`, yapılandırma dosyaları) üzerinde yapıldı. Kod
satır satır okundu ve Obsidian'ın resmi ESLint kurallarıyla (`eslint-plugin-obsidianmd`, `recommended`) tarandı.
Bulunan sorunlar düzeltildi; bu belge yapılanları ve bilinen sınırlamaları kayıt altına alır.

## Sonuç

| Kontrol | Sonuç |
| --- | --- |
| TypeScript (`tsc --noEmit`, strict) | Hatasız |
| Birim testleri (`npm test`) | 47/47 geçti |
| Resmi ESLint kuralları (`npm run lint`) | 0 hata, 5 bilinçli uyarı (bkz. SUBMISSION.md §3) |
| Production build (`npm run build`) | Başarılı |

## Düzeltilen sorunlar

### Hatalar

| # | Sorun | Etki | Düzeltme |
| --- | --- | --- | --- |
| 1 | Sync sırasında indirilen bir ek, vault'ta aynı adı taşıyan **başka bir dosyanın üzerine yazılabiliyordu**. Ekler ada göre aranıyordu. | Kullanıcı dosyalarının kaybı | Her ekin hangi XWiki sayfasından indirildiği kaydediliyor (`attachmentPaths`). Yalnızca aynı sayfanın aynı eki güncelleniyor, diğer durumlarda yeni dosya oluşturuluyor. Not içindeki linkler indirilen dosyanın gerçek yolunu gösteriyor. |
| 2 | Senkronize edilmiş bir klasöre eklenen yeni not, **yanlış XWiki konumuna** yayınlanıyordu (*Default space* + vault klasörleri, ör. `Alan.Alan.Dizin.Not`). | Yanlış yerde, iç içe tekrar eden sayfalar | Klasörün XWiki'den çekilmiş klasör notu (`Klasör.md`, `xwiki-reference` ile) varsa yeni not o sayfanın altına yerleşiyor. Klasör sayfası oluşturma da aynı kurala uyuyor. |
| 3 | XWiki'de başlık değiştiğinde notta **eski `xwiki-title` değeri** kalabiliyordu; sonraki publish eski başlığı geri yazıyordu. | Başlığın geri alınması | `xwiki-title` yalnızca dosya adından farklıysa yazılıyor, aksi halde siliniyor. |
| 4 | Tablolardaki takma adlı linkler (`[[Not\|takma ad]]`, Obsidian tabloda `\|` yazar) çözülemiyordu. | Kırık link | Tablo kaçışı tanınıyor. |
| 5 | Klasör yeniden adlandırma veya silmede içindeki notların senkron kayıtları güncellenmiyordu. | Değişiklik tespitinin bozulması | Klasör işlemleri alt yolları da güncelliyor veya temizliyor. |

### Sağlamlık

| # | Sorun | Düzeltme |
| --- | --- | --- |
| 6 | Kimlik doğrulama başarısız olup XWiki giriş sayfası (HTML) döndürdüğünde anlaşılmaz bir JSON hatası çıkıyordu. | Açık hata mesajı: *"XWiki did not answer with JSON … a login page may have been returned."* |
| 7 | Büyük eklerin yükleme ve indirmesi 60 saniyelik genel zaman aşımına takılabiliyordu. | Ek dosya işlemleri için 5 dakika. |
| 8 | Nested sayfa adresleri `/bin/view/A/B` biçimindeydi; aynı adda terminal sayfa varsa yanlış sayfaya gidebiliyordu. | Nested sayfalar için XWiki'nin kanonik biçimi kullanılıyor: `/bin/view/A/B/`. |
| 9 | Çakışma kopyası oluşturulduğunda ek dosya kayıtları diske yazılmıyordu. | Kayıt hemen kaydediliyor. |

### Güvenlik ve gizlilik

| # | Sorun | Düzeltme |
| --- | --- | --- |
| 10 | `http://` adresinde token şifresiz gidiyordu ve kullanıcı uyarılmıyordu. | Ayarlarda HTTPS uyarısı ve bağlantı testinde uyarı. `http(s)://` ile başlamayan adresler reddediliyor. |
| 11 | Testlerde ve belgelerde kuruma ait sunucu adı ve doküman adları vardı. | Nötr örneklerle değiştirildi (`wiki.example.com`, `Ekip Alanı`). |

Token hiçbir zaman loglanmaz: hata logları istek header'larını içermez. Token `data.json` dosyasında değil, Obsidian'ın
secret storage'ında tutulur.

### Obsidian kurallarına uyum

| # | Bulgu | Düzeltme |
| --- | --- | --- |
| 12 | `console.info` kullanımı (varsayılan konsolda görünür) | `console.debug` (yalnızca Verbose seviyesinde). |
| 13 | Ayarların ilk bölümünde başlık vardı ("Connection") | Kaldırıldı; genel ayarlar başlıksız, *Publishing* ve *Sync* başlıklı. |
| 14 | Arayüz metinlerinde sentence case uyarıları | Metinler sadeleştirildi; "XWiki" ve "Markdown" marka adı olarak tanımlandı. |
| 15 | `builtin-modules` bağımlılığı (dizin taramasında yasaklı bağımlılık) | Node'un `node:module` modülüyle değiştirildi. |
| 16 | Tip güvenliği (`any`) ve açıklamasız `eslint-disable` | Düzeltildi. |
| 17 | TypeScript 7 araç zinciriyle uyumsuzdu | TypeScript `~5.9` sürümüne sabitlendi. |

## Folder notes uyumluluğu (inceleme sonrası eklendi)

XWiki'de içeriği olan üst sayfalar, Obsidian'da yalnızca klasör olarak görünüyordu. Kendi klasör-not mekanizmamızı
yazmak yerine yaygın kullanılan [Folder notes](https://github.com/LostPaul/obsidian-folder-notes) eklentisinin
düzeni desteklendi. Gerekçe: dosya gezginine müdahale, Obsidian'ın resmi olmayan arayüzlerini gerektirir; bakım ve
inceleme riski taşır.

- Ayarlar: **Folder note location** (içinde veya yanında) ve **Folder note name** (`{{folder_name}}` şablonu).
  Varsayılanlar Folder notes'un varsayılanlarıyla aynı.
- Folder notes ayarları, eklentinin `<configDir>/plugins/folder-notes/data.json` dosyasından okunarak tek tıkla
  aktarılabiliyor. Dosya yalnızca okunuyor, hiçbir zaman yazılmıyor.
- Alt sayfası olan sayfalar, sync sırasında sayfa listesinden ya da vault'taki klasörün varlığından tespit ediliyor.
- Klasör notları yayınlanırken klasörün kendi sayfası olarak ele alınıyor.
- Ek birim testleri: klasör notu yolları, iki düzen, şablon adları, yayın konumu.

## XWiki linkleri ve tablo düzeltmesi (inceleme sonrası eklendi)

- **XWiki referansları:** XWiki Markdown 1.2'nin wiki tarzı link ve resimleri (`[[etiket|referans]]`,
  `![[alt|dosya]]`) Obsidian'ın ters sıralı `[[hedef|etiket]]` biçimiyle karışmasın diye çözülüyor: vault'ta
  karşılığı olan sayfa → `[[Not]]`, ek → `![[dosya]]`, diğerleri → XWiki adresi. Biçim, XWiki Markdown 1.2'nin kaynak
  kodu ve testleri incelenerek doğrulandı.
- **Tablolar:** Boş hücreler XWiki'de düşüp satırı birleşmiş gösterdiği için publish sırasında `&nbsp;` ile
  dolduruluyor, eksik hücreler tamamlanıyor; pull'da geri boşaltılıyor.
- **Makro koruma (isteğe bağlı):** XWiki sözdizimi sayfalarını kaynaktan Markdown 1.2'ye çeviren dönüştürücü
  (`src/xwiki21.ts`) **Keep XWiki macros** ayarına bağlı; varsayılan olarak kapalı. Kapalıyken sayfalar işlenmiş
  görünümlerinden dönüştürülür ve makrolar çıktılarıyla (link olarak) gelir. Açıkken makrolar birebir kopyalanır,
  `code` makrosu kod bloğuna, bilgi kutularının içeriği Markdown'a çevrilir; Markdown 1.2'nin makro sözdizimini
  desteklediği eklentinin kaynak kodu ve testlerinden doğrulandı.

## Ek dosya klasörü (inceleme sonrası eklendi)

- Çekilen sayfaların ekleri, notun yanındaki `assets` alt klasörüne iniyor (**Attachment folder** ayarı). Ekler
  Obsidian'ın genel ek ayarına göre vault köküne dağılıyordu.
- Not taşındığında veya ayar değiştiğinde ekler de taşınıyor; Obsidian linkleri güncelliyor. Boşalan eski klasörler
  çöp kutusuna gidiyor.
- Ekleri sayfaya göre kaydetmeden önce indirilmiş dosyalar, yalnızca çekilmiş bir not tarafından kullanılıyorsa
  sahipleniliyor ve taşınıyor. Başka notların kullandığı dosyalara dokunulmuyor.
- Ad çakışmasında numaralanan dosyalar (`logo 2.png`) publish sırasında XWiki'deki orijinal adlarıyla yükleniyor;
  böylece XWiki'de gereksiz yeni ekler oluşmuyor.

## İkinci genel inceleme (submit öncesi)

Kodun tamamı yeniden incelendi. Kullanılmayan kod, export ve bağımlılıklar için otomatik tarama yapıldı ve kod,
bağımsız bir ikinci inceleme ile satır satır gözden geçirildi. Düzeltilenler:

### Veri güvenliği

| Sorun | Düzeltme |
| --- | --- |
| Varsayılan ayarda (sync klasörü = vault kökü) kullanıcının taşıdığı XWiki notları bir sonraki sync'te geri taşınıyor, boşalan klasörler çöp kutusuna gidebiliyordu. | Her kayıt notun plugin tarafından yerleştirildiği yeri (`placedAt`) tutuyor. Not oradaysa taşınabiliyor; kullanıcı taşıdıysa yerinde kalıyor. Yalnızca plugin'in boşalttığı klasörler siliniyor. |
| Çakışma kararından önce ekler indiriliyor, "Keep both" seçilse bile yerel dosyaların üzerine yazılıyordu. | Önce karar veriliyor, sonra indiriliyor. |
| Ek sahiplenme, kullanıcının not tarafından linklenen başka dosyalarını da `assets` klasörüne taşıyabiliyordu. | Yalnızca adı sayfanın bir ekiyle eşleşen ve başka hiçbir not tarafından kullanılmayan dosyalar sahipleniliyor; mevcut kayıtların üzerine yazılmıyor. |
| Notun özelliklerine (frontmatter) etiket eklemek veya Obsidian'ın link güncellemeleri gereksiz `(XWiki conflict)` kopyaları üretiyordu. | Değişiklik özeti yalnızca not gövdesinden hesaplanıyor; plugin'in taşımalarından etkilenen notların özeti yenileniyor. |

### Doğruluk

| Sorun | Düzeltme |
| --- | --- |
| Ayrı bir sync klasörü kullanıldığında yeni notlar `Varsayılan space.XWiki.…` gibi yanlış yerlere yayınlanıyordu. | Sync klasörü içindeki klasörler XWiki kökünden itibaren space olarak yorumlanıyor. |
| Aynı başlıklı kardeş sayfaların alt sayfaları aynı klasörde birleşiyordu. | Klasör adları da numaralanıyor (`Docs`, `Docs 2`). |
| Vault'tan yayınlanan ekler, sonraki pull'da ikinci bir kopya olarak indiriliyordu. | Yüklenen dosyalar sayfanın ekleri olarak kaydediliyor. |
| Klasörün yanında duran klasör notları, sync klasörü dışında başlık değişince yeniden adlandırılıp klasörlerinden kopuyordu. | Her iki düzendeki klasör notları yeniden adlandırılmıyor. |
| Resim linkleri (`[![a](x)](x)`), `[[1]](adres)` kalıbı, girintili kod blokları ve HTML yorumları dönüşümde bozuluyordu. | Düzeltildi, testleri eklendi. |
| XWiki 2.x dönüştürücüsünde iç içe link parantezleri ve tablo hücresindeki makrolar bozuluyordu. | Düzeltildi, testleri eklendi. |
| `Sayfa@ek.png` referansları ve `page:../X` göreli referansları yanlış çözülüyordu. | Düzeltildi. Ek olarak `pageChain` fonksiyonunun sayfa dizisini kopyalamadan döndürdüğü bir hata bulundu ve düzeltildi. |
| Panelde bir alanı değiştirip hemen **Publish**'e basmak eski konuma yayın yapabiliyordu. | Panel, özellik yazımı ve indekslenmesi bitene kadar bekliyor. |

### Verimlilik ve temizlik

- Space sync sırasında ayar dosyası her sayfa için değil, işlem sonunda bir kez yazılıyor.
- Ekler yalnızca XWiki'deki sürümleri değiştiyse yeniden indiriliyor.
- Ek sahiplenme taraması tek geçişte yapılıyor; desteklenen sözdizimi kontrolü oturum boyunca önbellekte tutuluyor.
- Kullanılmayan alanlar (`XWikiError.status`, `ConnectionInfo.version`), gereksiz export'lar, `tslib` bağımlılığı
  ve kullanılmayan TypeScript ayarları kaldırıldı.

### Mevcut kullanıcı verisinin geçişi

- Eski kayıtlar (tam dosya özeti, `placedAt` olmadan) okunmaya devam ediyor; not bir sonraki senkronizasyonda yeni
  biçimle kaydediliyor.
- `placedAt` bilgisi olmayan eski notlar, ilk senkronizasyonda zaten XWiki'deki yerlerindeyse "plugin tarafından
  yerleştirilmiş" sayılıyor. Başka bir yerdeyse kullanıcının koyduğu yer kabul ediliyor ve not taşınmıyor.
- Sürüm bilgisi olmayan ekler yeniden indirilmiyor: vault'taki dosya güncel kabul ediliyor ve yalnızca XWiki'deki
  sürümü kaydediliyor. Böylece resimlerde yapılmış yerel düzenlemeler yükseltme sırasında ezilmiyor.

### Doğrulama turu

Düzeltmeler bağımsız olarak yeniden doğrulandı. Bu turda bulunan ve düzeltilenler:

- Eski kayıtlarda yerleştirme bilgisi hiç oluşmuyordu; artık ilk senkronizasyonda kaydediliyor (yukarıdaki kural).
- XWiki'den çekilmiş bir not yayınlandığında ekleri yanlışlıkla "kullanıcı dosyası" sayılıp taşınmaz hale geliyordu;
  düzeltildi.
- Plugin'in kendi taşımalarından sonra yerleştirme kayıtları, Obsidian olaylarının zamanlamasına bağlı kalmadan
  doğrudan güncelleniyor.
- Publish ile yüklenen, kullanıcıya ait ek dosyalar (`uploadedAttachments`) hiçbir zaman taşınmıyor.
- `assets` klasörü boşaltılırken üstündeki klasörler de siliniyordu; artık yalnızca `assets` klasörünün kendisi
  siliniyor.
- Başlığı değişen bir klasör notu, alt sayfalarının klasörüyle birlikte taşınıyor; böylece alt sayfalar ondan
  kopmuyor.
- Liste içindeki girintili satırlar kod bloğu sanılıyordu; düzeltildi.
- Başka bir adrese bağlanan resimlerin (ör. CI rozeti) linki korunuyor; XWiki 2.x'te link olarak kullanılan resimler
  yalnızca resim olarak dönüştürülüyor.
- İçeriği değişmeden yalnızca başlığı değişen sayfalarda eski `xwiki-title` kalıyordu; düzeltildi.
- Bilinen sınırlama: çakışma kopyası (`… (XWiki conflict).md`) yeni eklerin indirilmesini beklemez; bu kopyadaki yeni
  ek linkleri dosya adıyla yazılır.

## Bilinçli tasarım kararları

- **Tek seferde tek işlem:** Publish, pull ve sync aynı anda çalışmaz; böylece aynı not üzerinde yarış durumu
  (race condition) oluşmaz.
- **Sync klasörü bir aynadır:** Sync klasöründeki XWiki notları her senkronizasyonda XWiki'deki yerlerine taşınır.
  Kullanıcının vault'ta oluşturduğu notlar (`xwiki-reference` taşımayanlar) hiçbir zaman taşınmaz ve yeniden
  adlandırılmaz.
- **Silme senkronize edilmez:** Veri kaybı riskini önlemek için bilerek yapıldı.
- **Çakışmada yerel not korunur:** Toplu sync yerel notu ezmez, XWiki sürümünü yanına kopya olarak yazar.

## Bilinen sınırlamalar

| Sınırlama | Açıklama |
| --- | --- |
| Obsidian'a özgü sözdizimi | Vurgulama (`==metin==`), callout, blok referansı ve not gömme XWiki Markdown'da karşılıksızdır. |
| Markdown olmayan sayfaların dönüşümü | Kayıplıdır; makrolar çıktılarıyla (örneğin link olarak) gelir. HTML'den Markdown'a dönüşüm Obsidian'ın `htmlToMarkdown` fonksiyonuyla yapılır. |
| Sayfa adresi biçimi | Yalnızca `/bin/view/…` ve `/bin/download/…` biçimi desteklenir. |
| Solr gecikmesi | Yedek arama, indeks güncellenene kadar yeni sayfaları görmeyebilir. |
| Aynı başlıklı kardeş sayfalar | Vault'ta ikincisi `Başlık 2.md` olarak adlandırılır. |

## Test kapsamı

| Alan | Kapsam |
| --- | --- |
| Not → XWiki Markdown dönüşümü (`converter.ts`) | Birim testleri |
| XWiki Markdown → not dönüşümü (`reverse.ts`) | Birim testleri |
| Konum, referans, yol ve URL kuralları (`location.ts`) | Birim testleri |
| Token temizleme, sözdizimi listesi | Birim testleri |
| HTML → Markdown (`html.ts`) | Tarayıcı DOM'u gerektirir; manuel test |
| XWiki 2.x → Markdown 1.2 (`xwiki21.ts`, makro koruma) | Birim testleri |
| XWiki istemcisi, sync akışı, panel | Gerçek XWiki gerektirir; manuel test listesi: SUBMISSION.md §10 |

## Sonraki adımlar için öneriler

- `minAppVersion` 1.13'e yükseltildiğinde ayar sekmesi `getSettingDefinitions` API'sine taşınmalı. Böylece ayarlar
  Obsidian'ın ayar aramasında görünür ve kalan lint uyarıları kapanır.
- XWiki istemcisi için sahte (mock) `requestUrl` ile entegrasyon testleri eklenebilir.
- Callout'ların (`> [!note]`) XWiki tarafında bilgi kutusuna dönüştürülmesi değerlendirilebilir.
