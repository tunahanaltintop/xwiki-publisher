# Yayınlama ve Obsidian Community dizinine gönderme rehberi

Bu rehber, XWiki Publisher eklentisinin ilk sürümünü yayınlamak ve Obsidian Community dizinine (community.obsidian.md)
göndermek için gereken bütün adımları içerir. Obsidian'ın resmi dokümanlarına dayanır:

- [Submit your plugin](https://docs.obsidian.md/plugins/releasing/submit-plugin)
- [Submission requirements for plugins](https://docs.obsidian.md/community-directory/submission-requirements-for-plugins)
- [Developer policies](https://docs.obsidian.md/community-directory/developer-policies)
- [Plugin guidelines](https://docs.obsidian.md/Plugins/Releasing/Plugin+guidelines)
- [Manifest](https://docs.obsidian.md/Reference/Manifest)
- [Release your plugin with GitHub Actions](https://docs.obsidian.md/Plugins/Releasing/Release+your+plugin+with+GitHub+Actions)
- [Set up and claim](https://docs.obsidian.md/community-directory/set-up-and-claim),
  [Manage your plugin or theme](https://docs.obsidian.md/community-directory/manage-entry),
  [Community directory FAQ](https://docs.obsidian.md/community-directory/faq)

XWiki tarafında yapılması gerekenler ayrı bir belgededir: [XWIKI_SETUP.md](XWIKI_SETUP.md).

---

## 0. Başlamadan önce: kurumsal onay

Eklenti, herkese açık bir GitHub deposunda yayınlanacak ve MIT lisansıyla dağıtılacak. Kaynak kod, kurum adına
geliştirildiği için yayınlamadan önce:

- Kaynak kodun açık kaynak olarak yayınlanması ve lisans (MIT) için yöneticinizden ve ilgili birimden **yazılı onay**
  alın.
- Depoda kuruma ait bilgi bulunmadığını kontrol edin: iç sunucu adresleri, kullanıcı adları, token'lar, gerçek
  doküman adları. Kod incelemesinde bunlar temizlendi; her release öncesi aşağıdaki komutla tekrar kontrol edin.
  `<kurum-alan-adi>` yerine kurumunuzun alan adını ve iç sunucu adlarını yazın; komutu yerelde çalıştırın, bu
  değerleri depoya yazmayın:

  ```bash
  git grep -niE "<kurum-alan-adi>|bearer [a-z0-9]" -- . ':!package-lock.json'
  ```

- `.env` dosyası (yerel test vault yolu) `.gitignore` içindedir; depoya girmemelidir.

## 1. Gerekenler

| Gereken | Açıklama |
| --- | --- |
| GitHub hesabı | Kaynak kod ve release'ler burada tutulur. Obsidian, kullanıcılara dosyaları GitHub release'inden indirir. |
| Obsidian hesabı | community.obsidian.md'de oturum açmak için. |
| Node.js 22.9 veya üstü | `npm run build` betiği `--env-file-if-exists` seçeneğini kullanır. |

## 2. Yazar bilgileri

| Dosya | Alan | Değer |
| --- | --- | --- |
| `manifest.json` | `author` | Tunahan ALTINTOP |
| `manifest.json` | `authorUrl` | https://github.com/tunahanaltintop |
| `package.json` | `author`, `repository` | Tunahan ALTINTOP, `tunahanaltintop/xwiki-publisher` |
| `LICENSE` | Telif satırı | Copyright (c) 2026 Tunahan ALTINTOP |

Bağış kabul edilmediği için `manifest.json` içinde `fundingUrl` **yoktur** (gereksinim: *Only use fundingUrl to link
to services for financial support*).

## 3. Gereksinim kontrol listesi

Aşağıdaki tablo, Obsidian'ın gereksinimlerini ve eklentideki karşılıklarını gösterir. ✅ hazır, ⚠️ gönderimden önce
sizin yapmanız gereken bir adım var demektir.

### Depo dosyaları

| Gereksinim | Durum |
| --- | --- |
| Kök dizinde `README.md`: amaç ve kullanım | ✅ İngilizce; dizin sayfasında bu dosyadan alıntı gösterilir. |
| Kök dizinde `LICENSE` | ✅ MIT. GitHub depo sayfasında lisansın "MIT" olarak tanındığını kontrol edin. |
| Kök dizinde `manifest.json` | ✅ |
| `versions.json` | ✅ Eklenti sürümü → en düşük Obsidian sürümü eşlemesi; `npm version` ile otomatik güncellenir. |

### Manifest kuralları

| Kural | Durum |
| --- | --- |
| `id`: yalnızca küçük harf ve tire, `plugin` ile bitmez, `obsidian` içermez, benzersiz | ✅ `xwiki-publisher` |
| `name`: kısa, Basic Latin, "Obsidian" ve "Plugin" içermez | ✅ `XWiki Publisher` |
| `description`: eylemle başlar, en fazla 250 karakter, nokta ile biter, emoji yok, doğru büyük harf kullanımı (XWiki, Markdown) | ✅ 106 karakter |
| `version`: `x.y.z` | ✅ İlk release için `1.0.0` yapılacak (bkz. adım 4). |
| `minAppVersion`: gerçekten gereken en düşük sürüm | ✅ `1.11.4`: token için kullanılan `SecretStorage` ve `SecretComponent` API'leri bu sürümde geldi. |
| `isDesktopOnly`: Node.js veya Electron API'si kullanılıyorsa `true` | ✅ `false`: Node.js ve Electron kullanılmıyor; ağ istekleri Obsidian'ın `requestUrl` fonksiyonuyla yapılıyor. |

### Developer policies

| Politika | Durum |
| --- | --- |
| Kod gizlenmemiş (obfuscation yok) | ✅ Release, kaynaktan esbuild ile üretilen küçültülmüş (minified) dosyadır; kaynak açık. |
| Reklam yok, telemetri yok | ✅ |
| Kendini veya bağımlılıklarını güncellemiyor | ✅ |
| **README'de açıklama gerekenler** | |
| Ağ kullanımı: hangi servis, neden | ✅ README → *Privacy, network use and accounts* |
| Hesap gerekliliği | ✅ XWiki hesabı ve token gerektiği yazılı. |
| Vault dışındaki dosyalara erişim | ✅ Yok; README'de belirtildi. |
| Ödeme | ✅ Yok. Dizin formunda **Free** seçin. |
| Lisans ve üçüncü taraf lisansları | ✅ Çalışma zamanında bağımlılık yok; yalnızca geliştirme araçları var. |
| Marka kullanımı | ✅ "Obsidian" adı kullanılmıyor; README'de XWiki SAS ile bağlantı olmadığı belirtildi. |
| Fork değil | ✅ Sıfırdan yazıldı. |

### Submission requirements

| Gereksinim | Durum |
| --- | --- |
| Komut kimliklerinde eklenti kimliği yok | ✅ `publish-current-note`, `pull-current-note`, `import-page`, `sync-space`, `open-panel`, `open-published-page` |
| Örnek (sample) kod kaldırılmış | ✅ |
| Node.js veya Electron yalnızca masaüstünde | ✅ Kullanılmıyor. |

### Plugin guidelines (inceleme yorumlarında sık geçenler)

| Yönerge | Durum |
| --- | --- |
| `this.app` kullanımı, global `app` yok | ✅ |
| Konsolda gereksiz log yok | ✅ Varsayılan seviyede yalnızca hatalar görünür; tanı logları `console.debug` (Verbose) seviyesinde. |
| Arayüz metinleri sentence case; ayarlarda tek bölüm başlığı kuralı; `setHeading()` | ✅ |
| `innerHTML`, `outerHTML` yok | ✅ DOM, `createEl` ve `createDiv` ile kuruluyor. |
| Varsayılan kısayol (hotkey) yok | ✅ |
| Kaynaklar unload'da temizleniyor (`registerEvent`, `registerView`, `register`) | ✅ |
| `onunload` içinde leaf detach yok | ✅ |
| View referansı eklentide tutulmuyor | ✅ |
| Arka planda dosya değişikliği için `Vault.process`, frontmatter için `processFrontMatter` | ✅ |
| Kullanıcı yolları `normalizePath` ile temizleniyor | ✅ |
| Sabit (inline) stil yok; CSS sınıfları ve Obsidian değişkenleri | ✅ `styles.css` |
| Lookbehind regex yok (eski iOS sürümleri) | ✅ |

### Resmi ESLint kuralları

Dizin, kaynak kodu Obsidian'ın ESLint kurallarıyla tarar. Aynı kurallar projede kurulu:

```bash
npm run lint
```

Beklenen sonuç: **0 hata, 2 uyarı.** İkisi de yalnızca Obsidian 1.13'ten eski sürümler için tutulan yedek
yollarda:

| Uyarı | Neden kaldı |
| --- | --- |
| `setWarning` deprecated | Obsidian 1.13 ve üstünde `setDestructive` kullanılıyor; `setWarning` yalnızca eski sürümlerde çağrılıyor. |
| `display()` deprecated | Obsidian 1.13 ve üstünde ayarlar `getSettingDefinitions` ile tanımlanıyor (ayar aramasında görünür); `display()` yalnızca eski sürümlerde kullanılıyor. |

Uyarılar gönderimi engellemez. Dizin bunları "Warning" olarak gösterir.

## 4. Sürümü hazırlama

Obsidian sürümleri `x.y.z` biçimindedir ve **release etiketi (tag) `manifest.json` içindeki sürümle birebir aynı
olmalıdır**: `v` öneki olmamalı. Projedeki `.npmrc` dosyası (`tag-version-prefix=""`) `npm version` komutunun `v`
öneki eklemesini engeller.

```bash
# Temiz çalışma dizini ve geçen kontroller
npm ci
npm run lint
npm test
npm run build

# İlk release için:
npm version 1.0.0
```

`npm version` komutu sırasıyla:

1. `package.json` sürümünü `1.0.0` yapar.
2. `version-bump.mjs` betiğini çalıştırır: `manifest.json` sürümünü günceller ve `versions.json` dosyasına
   `"1.0.0": "1.11.4"` satırını ekler.
3. Değişiklikleri commit'ler ve `1.0.0` etiketini oluşturur.

Sonraki sürümlerde `npm version patch`, `npm version minor` veya `npm version major` kullanın. `minAppVersion`
değişirse önce `manifest.json` içinde güncelleyin; `versions.json` doğru eşlemeyi otomatik alır.

`CHANGELOG.md` dosyasına sürüm notlarını ekleyin.

## 5. GitHub deposu

1. GitHub'da **herkese açık (public)** bir depo oluşturun; örneğin `xwiki-publisher`. Varsayılan dal `main` olsun.
2. Yerel depoyu bağlayıp gönderin:

   ```bash
   git remote add origin https://github.com/tunahanaltintop/xwiki-publisher.git
   git push -u origin main
   ```

3. **Settings → Actions → General → Workflow permissions** altında **Read and write permissions** seçeneğini
   etkinleştirin. Release iş akışı, release oluşturmak için bu izne ihtiyaç duyar.
4. Depoda iki iş akışı var:
   - `.github/workflows/ci.yml`: her push ve pull request'te lint, test ve build çalıştırır.
   - `.github/workflows/release.yml`: etiket push edildiğinde çalışır. Etiketin manifest sürümüyle aynı olduğunu
     doğrular, lint, test ve build çalıştırır, build attestation üretir ve `main.js`, `manifest.json`, `styles.css`
     dosyalarını içeren **taslak (draft) release** oluşturur.

> Kaynak kodu gizli tutmak gerekirse Obsidian buna da izin verir: derlenmiş release dosyaları herkese açık bir
> depoda, kaynak kod ayrı bir gizli depoda tutulur ve "Obsidian Community directory" GitHub App'i gizli depoya
> okuma izniyle kurulur. Ayrıntı: *Manage your plugin or theme → Add a private source repository*.

## 6. Release oluşturma

```bash
git push origin main
git push origin 1.0.0     # etiket, release iş akışını başlatır
```

1. GitHub'da **Actions** sekmesinde "Release Obsidian plugin" iş akışının başarıyla bittiğini kontrol edin.
2. **Releases** altında `1.0.0` adlı taslak release'i açın.
3. Release notlarını yazın (`CHANGELOG.md` içeriğinden). Release adı Obsidian tarafından kullanılmaz.
4. Ek dosyaların **`main.js`, `manifest.json`, `styles.css`** olduğunu doğrulayın.
5. **Publish release** ile yayınlayın.

Obsidian, kullanıcı eklentiyi kurduğunda bu üç dosyayı, etiketi `manifest.json` sürümüyle eşleşen release'ten indirir.
Bu yüzden hem commit'lenmiş manifest hem de release gereklidir.

## 7. Community dizinine gönderme

1. [community.obsidian.md](https://community.obsidian.md) adresinde sağ üstten **Sign in** ile Obsidian hesabınızla
   oturum açın.
2. **Profile → GitHub → Connect** ile GitHub hesabınızı bağlayın. Dizin, deponun size ait olduğunu bu bağlantıyla
   doğrular.
3. İsteğe bağlı: **Action required notifications** seçeneğini açın. Tarama hatası olduğunda e-posta alırsınız.
4. Kenar çubuğunda **Plugins → New plugin**:
   - **GitHub repository URL**: `https://github.com/tunahanaltintop/xwiki-publisher`
   - **Owner**: kendiniz veya üyesi olduğunuz bir organizasyon. Ekip sahipliği için önce bir organizasyon
     oluşturabilirsiniz.
5. Developer policies'i okuyup onaylayın ve eklentiyi desteklemeye devam edeceğinizi teyit edin. Ardından **Submit**.

Dizin, depo varsayılan dalının **HEAD'indeki** `manifest.json` dosyasını işler. Gönderimden önce manifest'in doğru
ve commit'lenmiş olduğundan emin olun.

### Listeleme bilgileri (Edit listing)

| Alan | Öneri |
| --- | --- |
| Short description | Manifest açıklamasıyla aynı. |
| Long description | README'deki *Features* bölümü. |
| Categories | Örneğin "Publishing", "Sync" (dizinde mevcut kategorilerden seçin). |
| Payment type | **Free** |
| Screenshots | En fazla 5 masaüstü (1200×800) ve 5 mobil (900×1600) görüntü; JPEG, PNG veya WebP, en fazla 5 MB. Önerilenler: yan panel, ayarlar, yayınlanmış bir XWiki sayfası, senkronize edilmiş klasör ağacı. Görüntülerde kuruma ait içerik olmamalıdır; örnek bir vault ve örnek bir XWiki kullanın. |

## 8. Otomatik inceleme

Her release'ten sonra dizin şu bölümleri tarar ve her sonucu **Error**, **Warning**, **Recommendation** veya
**Pass** olarak işaretler:

| Bölüm | Ne kontrol edilir |
| --- | --- |
| Manifest | Alan kuralları (adım 3). |
| Releases | Etiket ile sürüm uyumu, release dosyaları. |
| Source code | ESLint kuralları (`npm run lint` ile aynı). |
| Build verification | Depodaki kaynaktan yapılan build'in release'teki `main.js` ile aynı olması. Tarayıcı sırasıyla `build`, `build:plugin`, `compile` betiklerinden ilk bulduğunu kullanır; bu projede `npm run build`. |

Tarayıcı şu dosya ve klasörleri yok sayar, bu yüzden testler ve araç betikleri incelemeyi etkilemez: `tests`,
`docs`, `*.mjs` (`esbuild.config.mjs`, `version-bump.mjs`, `eslint.config.mjs`), `node_modules`.

- Release yapmadan önce taramayı denemek için: giriş sayfasında **Review branch → Run preview scan**.
- Yeni release hemen görünmüyorsa: **… → Check for new releases**.
- Hata düzeltildikten sonra: sürümü artırıp yeni release yapın veya **… → Request review** seçin.
- Otomatik incelemede hata kalmadığında eklenti Obsidian içinden kurulabilir hale gelir.

### Sık karşılaşılan sorunlar

| Sorun | Çözüm |
| --- | --- |
| "The repository does not have a recognized license" | GitHub depo sayfasında lisansın "MIT" olarak göründüğünü kontrol edin; `LICENSE` metnini değiştirmeyin, yalnızca telif satırını doldurun. |
| Build verification başarısız | Release'i elle değil iş akışıyla oluşturun; `package-lock.json` commit'lenmiş olmalı ve `npm ci` kullanılmalı. |
| Etiket ile sürüm uyuşmuyor | Etiket `1.0.0` olmalı, `v1.0.0` değil. |
| "Invalid identifier" | `id` yayınlandıktan sonra değiştirilemez; Obsidian Discord'undaki `#community-directory` kanalına yazın. |

### İlk gönderimin inceleme sonucu (1.0.0)

| Bölüm | Sonuç | Yapılan |
| --- | --- | --- |
| Behavior | Recommendation: *Vault Enumeration* | 1.0.1'de giderildi: plugin vault'u listelemiyor, yalnızca senkronize ettiği notları açıyor. |
| Source code | Warning: `getSettingDefinitions` yok | 1.0.1'de giderildi: bildirimsel ayar API'si eklendi. |
| Source code | Warning: gereksiz tip dönüşümü (`view.ts`) | 1.0.1'de giderildi. |
| Source code | Recommendation: `setWarning`, `display` deprecated | Obsidian 1.13+ için yeni API'ler kullanılıyor; eski çağrılar yalnızca eski sürümler için kaldı. |

## 9. Yayından sonra

- Güncellemeler için yeniden gönderim gerekmez: `npm version patch` → `git push origin main --follow-tags` → taslak
  release'i yayınla.
- Duyuru (isteğe bağlı): Obsidian forumunda [Share & showcase](https://forum.obsidian.md/c/share-showcase/9) ve
  Discord'da `#updates` kanalı (bunun için `developer` rolü gerekir).
- Eklenti artık desteklenemeyecekse dizinden **Archive** edin veya sahipliği devredin.

## 10. Release öncesi manuel test listesi

Otomatik testler dönüştürme ve konum kurallarını kapsar. XWiki ile etkileşim ancak gerçek bir sunucuda test edilebilir.
Her release öncesinde bir **test vault'u** ve bir **test space'i** ile şunları deneyin (gerçek kurum dokümanlarını
kullanmayın):

| # | Senaryo | Beklenen |
| --- | --- | --- |
| 1 | Test connection | "Connected to XWiki as …" ve Markdown sözdizimleri listelenir. |
| 2 | Resim ve PDF içeren notu yayınla | Sayfa `markdown/1.2` sözdiziminde; resim görünür, PDF linki iner. |
| 3 | Notu değiştirip tekrar yayınla | Aynı sayfa güncellenir; panelde "In sync". |
| 4 | XWiki'de sayfayı değiştir, **Check XWiki** ve **Pull** | Değişiklik farkı bildirilir; pull sonrası not güncellenir. |
| 5 | Hem notu hem sayfayı değiştir, **Pull** | "Keep both / Overwrite" sorusu çıkar. |
| 6 | Aynı durumda **Publish** | Üzerine yazmadan önce onay istenir. |
| 7 | Alt sayfaları olan bir space'i **Sync** et | Ağaç vault'ta kökten kurulur; notlar başlıklarla adlandırılır. |
| 8 | `xwiki/2.1` sayfası içeren space'i sync et | Sayfa Markdown'a çevrilir; panelde dönüşüm uyarısı görünür. |
| 9 | XWiki'de bir sayfanın başlığını değiştir, tekrar sync | Not yeniden adlandırılır, linkler güncellenir. |
| 10 | Senkronize edilmiş klasöre yeni not ekleyip yayınla | Sayfa, o klasörün XWiki sayfasının altında oluşur. |
| 11 | Folder notes kurulu vault'ta alt sayfalı bir space'i sync et | Alt sayfası olan sayfalar `Klasör/Klasör.md` olarak yazılır; klasöre tıklayınca içerik açılır. |
| 12 | Folder notes'ta *Storage location* değiştir, **Use Folder notes settings → Copy**, tekrar sync | Çekilmiş klasör notları yeni düzene taşınır. |
| 13 | Bir klasör notunu (`Klasör/Klasör.md`) yayınla | Klasörün kendi sayfası güncellenir; `Klasör.Klasör` gibi bir sayfa oluşmaz. |
| 14 | **Keep XWiki macros** açıkken `{{toc/}}` ve `{{info}}` makroları içeren `xwiki/2.1` sayfasını pull edip yayınla | Not makroları metin olarak içerir; yayından sonra XWiki'de makrolar çalışır. Ayar kapalıyken makrolar link/çıktı olarak gelir. |
| 15 | İkinci sütundan itibaren boş hücreler içeren tabloyu yayınla | XWiki'de sütun yapısı korunur; pull sonrası hücreler yine boş. |
| 16 | Resimli bir sayfayı sync et | Ekler notun yanındaki `assets` klasörüne iner; ana dizine dosya düşmez. |
| 17 | Çekilmiş bir notu başka bir klasöre taşı, XWiki'de sayfayı değiştir, tekrar sync | Not taşıdığınız yerde kalır ve güncellenir; boşalan klasörünüz silinmez. |
| 18 | Çekilmiş bir nota etiket (property) ekle, XWiki'de sayfayı değiştir, tekrar sync | Çakışma kopyası oluşmaz; not güncellenir, etiket korunur. |
| 19 | Mobil emülasyon (`this.app.emulateMobile(true)` geliştirici konsolunda) | Panel ve komutlar çalışır. |
