# XWiki tarafında yapılması gerekenler

Bu belge, XWiki Publisher eklentisinin çalışması için XWiki yöneticilerinin yapması gereken ayarları ve her birinin
nasıl doğrulanacağını anlatır. Eklenti yalnızca XWiki'nin standart REST API'sini ve sayfa adreslerini kullanır;
XWiki'ye ek bir bileşen kurmaz.

> Bu belgedeki XWiki yönetim ekranı adları XWiki sürümüne göre küçük farklılıklar gösterebilir. Komutlarla yapılan
> doğrulamalar sürümden bağımsızdır; her ayarı uygulamaya almadan önce test ortamında doğrulayın.

## Özet kontrol listesi

| # | Gereksinim | Neden gerekli | Zorunlu mu |
| --- | --- | --- | --- |
| 1 | **Markdown Syntax 1.2** eklentisi kurulu | Sayfalar `markdown/1.2` sözdizimiyle yazılır. | Evet (yayınlama için) |
| 2 | **Token ile kimlik doğrulama** hem `/rest/…` hem `/bin/…` adreslerinde | Tüm istekler kullanıcının token'ıyla yapılır. | Evet |
| 3 | **HTTPS** | Token her istekte gönderilir. | Evet |
| 4 | **Kullanıcı hakları**: senkronize edilen alanlarda *view*, yayınlanan alanlarda *edit* | Okuma ve yazma. | Evet |
| 5 | Ters vekil sunucu (reverse proxy) `Authorization` header'ını iletiyor | Aksi halde istekler misafir (guest) olarak çalışır. | Evet (proxy varsa) |
| 6 | REST sorgularında **Solr** sorgu tipine izin | Space listesinde görünmeyen alanlar için yedek arama. | Önerilir |
| 7 | **Solr arama indeksi** güncel | Yedek arama bu indeksi kullanır. | Önerilir |
| 8 | Ek dosya boyutu sınırları (XWiki ve proxy) | Büyük resim ve PDF'lerin yüklenebilmesi. | Önerilir |
| 9 | Sayfa adresleri `/bin/view/…` ve `/bin/download/…` biçiminde | Eklenti linkleri bu biçimle tanır. | Evet |
| 10 | Editörlerde Markdown sözdiziminin seçilebilmesi | XWiki'de yeni sayfaların da Markdown ile yazılabilmesi. | İsteğe bağlı |

## 1. Markdown Syntax 1.2 eklentisi

Eklenti, notları XWiki'ye **`markdown/1.2`** sözdiziminde kaydeder. Böylece sayfanın kaynağı Markdown olarak kalır ve
Obsidian'a kayıpsız geri çekilebilir.

**Kurulum** (yönetici hesabıyla):

1. **Administer Wiki → Extensions** (Extension Manager) ekranını açın.
2. **Markdown Syntax 1.2** eklentisini arayın
   ([eklenti sayfası](https://extensions.xwiki.org/xwiki/bin/view/Extension/Markdown%20Syntax%201.2/)) ve kurun.
   Eklenti sayfasındaki uyumlu XWiki sürümlerini kontrol edin.
3. Çok wiki'li (farm) kurulumlarda eklentiyi, eklentinin kullanılacağı wiki'ye (veya tüm farm'a) kurun.

**Doğrulama:**

- Obsidian'da eklenti ayarlarındaki **Test connection** mesajında `markdown/1.2` görünmelidir.
- Komutla (token gerekmez):

  ```bash
  curl -s -H "Accept: application/json" https://wiki.example.com/rest/syntaxes
  ```

  Çıktıda `markdown/1.2` bulunmalıdır.

Eklenti kurulu değilse yayınlama işlemi bilerek durdurulur: *"XWiki cannot parse markdown/1.2 … ask an XWiki admin to
install the Markdown Syntax extension."* Bu koruma, açılamayan bozuk sayfaların oluşmasını önler.

## 2. Token ile kimlik doğrulama

Eklenti her isteği kullanıcının **erişim token'ıyla** yapar. XWiki çekirdeği tek başına token kabul etmez; bunu bir
kimlik doğrulama eklentisi sağlar. Örneğin **OpenID Connect Provider** eklentisi kullanıcıların profillerinden token
üretmesini sağlar ve token şu header ile kabul edilir:

```
Authorization: Bearer <token>
```

Eklenti üç gönderim şeklini destekler (ayarlarda **Authentication method**):

| Yöntem | Gönderilen header | Ne zaman |
| --- | --- | --- |
| Bearer token (varsayılan) | `Authorization: Bearer <token>` | OIDC Provider ve benzeri token doğrulayıcılar |
| Basic (username + token) | `Authorization: Basic base64(kullanıcı:token)` | Token'ın parola yerine kabul edildiği kurulumlar |
| Custom header | `<seçilen header>: <token>` | Kuruma özel kimlik doğrulama |

**Önemli:** Token yalnızca REST API'de (`/rest/…`) değil, sayfa adreslerinde de (`/bin/view/…`, `/bin/get/…`,
`/bin/download/…`) kabul edilmelidir. Eklenti, Markdown olmayan sayfaları dönüştürürken sayfanın görünümünü
`/bin/view/…` adresinden alır.

**Doğrulama:** Token'ı kabuk geçmişine yazmamak için önce gizli olarak okuyun:

```bash
read -s TOKEN    # token'ı yapıştırıp Enter'a basın; ekranda görünmez
```

```bash
# 1) REST: XWiki-User header'ı kullanıcıyı göstermeli, XWiki.XWikiGuest olmamalı
curl -s -o /dev/null -D - -H "Authorization: Bearer $TOKEN" \
  https://wiki.example.com/rest/wikis/xwiki | grep -i "xwiki-user"

# 2) Sayfa görünümü: içerik alanı gelmeli, giriş formu gelmemeli
curl -s -H "Authorization: Bearer $TOKEN" \
  "https://wiki.example.com/bin/view/Main/" | grep -c 'id="xwikicontent"'
```

İlk komut `XWiki-User: xwiki:XWiki.<kullanıcı>` döndürmeli, ikinci komut `1` veya daha büyük bir sayı vermelidir.
Sonra `unset TOKEN` ile değişkeni silin.

**Token güvenliği (kullanıcılara iletin):**

- Token'ı nota, e-postaya veya sohbete yazmayın. Yalnızca eklenti ayarlarındaki **Token** alanına girin; değer
  Obsidian'ın güvenli deposunda (secret storage) saklanır.
- Token açığa çıkarsa XWiki'deki profilden hemen iptal edip yenisini oluşturun.
- Mümkünse token'lara son kullanma süresi tanımlayın.

## 3. HTTPS

Token her istekle gönderildiği için XWiki'ye yalnızca HTTPS ile erişilmelidir. Eklenti, adres `http://` ile
başlıyorsa bağlantı testinde uyarı verir.

## 4. Kullanıcı hakları

| İşlem | Gereken hak | Nerede |
| --- | --- | --- |
| Pull, import, sync, check | **View** | Okunan sayfalar ve üst alanları |
| Publish (sayfa oluşturma, güncelleme) | **Edit** | Hedef sayfa veya space |
| Ek dosya yükleme | **Edit** | Hedef sayfa |
| Klasör sayfası oluşturma (*Create folder pages*) | **Edit** | Klasörlere karşılık gelen üst alanlar |

*Script*, *programming*, *admin* veya *delete* hakları **gerekmez**. Eklenti hiçbir sayfayı silmez.

Yetki eksikse eklenti şu hatayı gösterir: *"Access denied: xwiki:XWiki.<kullanıcı> has no edit right on <sayfa>"*.
XWiki bu durumda 401 kodu döndürse de sorun token'da değil haktadır.

Kurumsal öneri: Obsidian'dan yayın yapılacak alanları netleştirin (örneğin ekip alanları) ve **edit** hakkını
yalnızca bu alanlarda verin.

## 5. Ters vekil sunucu (reverse proxy)

XWiki önünde Nginx, Apache veya bir yük dengeleyici varsa:

- `Authorization` header'ı (veya özel header kullanılıyorsa o header) XWiki'ye **iletilmelidir**. Bazı
  yapılandırmalar bu header'ı siler; o durumda istekler misafir olarak çalışır.
- İstek gövdesi sınırı, ek dosyaların yüklenebileceği kadar büyük olmalıdır. Örneğin Nginx'te
  `client_max_body_size 50m;`.
- Zaman aşımları büyük ek dosyalar için yeterli olmalıdır. Eklenti normal istekleri 60 saniye, ek dosya
  yükleme ve indirmeyi 5 dakika sonra keser.

**CORS ayarı gerekmez.** Eklenti istekleri Obsidian'ın `requestUrl` fonksiyonuyla yapar; bu istekler tarayıcının CORS
kısıtlarına tabi değildir.

**CSRF koruması etkilenmez.** Eklenti `application/xml`, `application/json` ve `application/octet-stream` içerik
tipleriyle istek yapar. XWiki'nin form token (CSRF) denetimi yalnızca form içerik tiplerine uygulanır.

## 6. REST sorgu tipleri ve Solr

**Sync space** işlemi bir alandaki sayfaları şu sırayla bulur:

1. `GET /rest/wikis/{wiki}/spaces` ile space listesi; ardından her space için `GET …/spaces/{space}/pages`.
2. Alan bu listede yoksa XWiki'nin **Solr** arama indeksi:
   `GET /rest/wikis/{wiki}/query?type=solr&q=…`

XWiki varsayılan olarak REST üzerinden yalnızca **Solr** sorgularına izin verir; XWQL ve HQL kapalıdır. Eklenti de
yalnızca Solr kullanır, bu yüzden bu ayarın değiştirilmesi **gerekmez**. Solr sorgu tipi kapatılmışsa yedek arama
çalışmaz.

**Solr indeksi:** Yedek arama indeksi kullandığı için indeksin güncel olması gerekir. Yeni kaydedilen sayfalar
indekse birkaç saniye gecikmeyle girer. İndeks eksik veya bozuksa **Administer Wiki → Search** ekranından yeniden
indeksleme yapılabilir.

## 7. Ek dosya boyutu

XWiki'nin yönetim ekranındaki **en büyük ek dosya boyutu** ayarı ve proxy'nin istek gövdesi sınırı, kullanıcıların
notlarına eklediği dosyaları kapsamalıdır. Sınırı aşan ekler için eklenti *"Failed to upload …"* uyarısı verir; sayfa
yine de yayınlanır.

## 8. Sayfa adresleri

Eklenti, XWiki linklerini ve ek dosya adreslerini şu biçimde üretir ve tanır:

```
<XWiki URL>/bin/view/<Space>/<Alt space>/<Sayfa>/
<XWiki URL>/bin/download/<Space>/<Alt space>/<Sayfa>/WebHome/<dosya>
```

`<XWiki URL>`, kullanıcıların ayarlara girdiği taban adrestir: XWiki kökte çalışıyorsa `https://wiki.example.com`,
`/xwiki` altında çalışıyorsa `https://wiki.example.com/xwiki`. `/bin/` yolunu değiştiren özel URL yapılandırmaları
desteklenmez.

## 9. İsteğe bağlı: XWiki'de Markdown ile yazma

Obsidian'dan gelmeyen sayfaların da kayıpsız senkronize olması için kullanıcıların XWiki'de yeni sayfaları Markdown
ile yazabilmesi faydalıdır. **Administer Wiki → Editing → Syntaxes** ekranında **Markdown 1.2** sözdizimini
etkinleştirin. İsterseniz belirli alanlar için varsayılan sözdizimi yapın.

Markdown dışındaki sayfalar (`xwiki/2.1`) de senkronize edilir. Ancak:

- Bu sayfalar Obsidian'a **dönüştürülerek** gelir: XWiki sayfayı işler ve sonuç Markdown'a çevrilir. Makrolar
  çalıştırılmış çıktılarıyla (örneğin link olarak) gelir, makro olarak değil.
- Böyle bir not Obsidian'dan yayınlanırsa sayfanın sözdizimi Markdown'a geçer ve sayfadaki makrolar yerini
  çıktılarına bırakır. Eklenti bunu yapmadan önce kullanıcıdan onay ister.

Makro yoğun sayfaları (paneller, uygulama sayfaları, dinamik tablolar, OpenProject listeleri) Obsidian'dan
düzenlenecek alanların dışında tutmanız önerilir.

### İsteğe bağlı: makroları koruma

Eklenti ayarlarındaki **Keep XWiki macros** seçeneği (varsayılan: kapalı) açıldığında `xwiki/2.x` sayfaları
işlenmiş görünüm yerine **kaynak kodlarından** dönüştürülür ve **makrolar olduğu gibi korunur**. Markdown 1.2
eklentisi XWiki makro sözdizimini aynen desteklediği için, not yayınlandığında makrolar (örneğin `{{toc/}}`,
`{{info}}`, `{{openproject …/}}`) XWiki'de yine çalışır. Bu durumda:

- Kullanılan makroların eklentileri XWiki'de kurulu olmalıdır; örneğin OpenProject makroları için OpenProject
  entegrasyon eklentisi. Kurulu olmayan bir makro sayfada *"Unknown macro"* hatası verir.
- Altı çizili metin, CSS sınıfları ve `(% %)` parametreleri gibi Markdown karşılığı olmayan biçimlendirmeler yayında
  kaybolur.
- Kaynağı boş olan sayfalar (içeriği sheet'ten gelen uygulama sayfaları) yine görünümden dönüştürülür.

### Tablolar

Markdown tablolarındaki boş hücreler XWiki'de düşebilir ve satır birleşmiş gibi görünebilir. Eklenti bu yüzden
publish sırasında boş hücrelere bölünmez boşluk (`&nbsp;`) yazar ve kısa satırları başlık satırının sütun sayısına
tamamlar. Pull sırasında bu boşluklar yeniden boş hücreye çevrilir. XWiki tarafında ek bir ayar gerekmez.

## Eklentinin kullandığı adresler

| İstek | Amaç |
| --- | --- |
| `GET /rest/wikis/{wiki}` | Bağlantı testi; `XWiki-User` header'ından kullanıcı okunur |
| `GET /rest/syntaxes` | Sunucudaki sözdizimlerinin listesi |
| `GET, PUT /rest/wikis/{wiki}/spaces/…/pages/{sayfa}` | Sayfa okuma, oluşturma ve güncelleme (XML gövde, `syntax` alanı ile) |
| `GET, PUT …/pages/{sayfa}/attachments/{dosya}` | Ek dosya indirme ve yükleme |
| `GET …/pages/{sayfa}/attachments` | Yalnızca ek içeren sayfalarda ek listesi |
| `GET /rest/wikis/{wiki}/spaces`, `…/spaces/{space}/pages` | Sync için space ve sayfa listesi |
| `GET /rest/wikis/{wiki}/query?type=solr` | Sync için yedek arama |
| `GET /bin/view/…` | Markdown olmayan sayfaların görünümü (dönüştürme için) |
| `GET /bin/get/…?xpage=plain` | Görünümde içerik alanı yoksa yedek |

Eklenti başka hiçbir servise bağlanmaz ve telemetri göndermez.

## Sorun giderme

| Belirti | Olası neden | Ne yapılmalı |
| --- | --- | --- |
| "Authentication failed (401). Check your XWiki token." | Token geçersiz, süresi dolmuş veya iptal edilmiş | Yeni token oluşturun; 2. bölümdeki doğrulamayı yapın. |
| "token was not accepted (request ran as guest)" | Token doğrulayıcı header'ı kabul etmiyor veya proxy header'ı siliyor | 2. ve 5. bölümler. |
| "Access denied: … has no edit right on …" | Hak eksik | 4. bölüm. |
| "XWiki cannot parse markdown/1.2" | Markdown Syntax 1.2 kurulu değil | 1. bölüm. |
| "XWiki did not answer with JSON … a login page may have been returned" | İstek giriş sayfasına yönlendirildi | Token doğrulayıcısının REST ve `/bin` adreslerinde çalıştığını doğrulayın. |
| Sync "No page found at or below …" | Space listede yok ve Solr sorgusu çalışmadı veya indeks eksik | 6. bölüm. |
| Pull edilen not boş geliyor | Sayfa içeriği yalnızca uygulama veya şablonla gösteriliyor ve görünüm alınamıyor | `/bin/view` doğrulaması (2. bölüm); geliştirici konsolunda (Verbose) `page converted to empty Markdown` satırı. |
| "XWiki did not answer within 60 s" | Sunucu veya proxy yavaş | Proxy zaman aşımları, sunucu yükü. |
