# OpenProject bağlantı gereksinimleri

Bu belge, XWiki Publisher'ın publish sırasında XWiki sayfalarını OpenProject iş paketlerine bağlayabilmesi için
OpenProject ve XWiki tarafında nelerin hazır olması gerektiğini ve her birinin nasıl doğrulanacağını anlatır.
Entegrasyon isteğe bağlıdır: ayarlarda OpenProject adresi boşsa eklenti OpenProject'e hiç bağlanmaz.

> **Bağlantı, OpenProject'in yerleşik XWiki entegrasyonunu kullanır.** Sayfa, iş paketinin **Wikis** sekmesine bağlı
> sayfa olarak eklenir; iş paketine yorum yazılmaz, açıklaması değiştirilmez.

## Özet kontrol listesi

| # | Gereksinim | Neden gerekli | Zorunlu mu |
| --- | --- | --- | --- |
| 1 | **OpenProject 17.6 veya üzeri** | Wiki bağlantıları ve API'si bu sürümle geldi. | Evet |
| 2 | **Enterprise Corporate planı** (cloud veya on-premises) | XWiki entegrasyonu bu planın eklentisidir. | Evet |
| 3 | XWiki'de **OpenProject Integration (Pro)** eklentisi | Sayfa kimliği ve XWiki kurulum kimliği bu eklentinin REST adreslerinden okunur. | Evet |
| 4 | XWiki, OpenProject'te **wiki sağlayıcısı** olarak tanımlı ve etkin | Bağlantılar bu sağlayıcıya kaydedilir. | Evet |
| 5 | Kullanıcıya ait **OpenProject API token'ı** | Tüm OpenProject istekleri bu token ile yapılır. | Evet |
| 6 | Token sahibinin projelerde **iş paketlerini görme** ve **wiki sayfa bağlantılarını yönetme** izni | Bağlantıları okuma, ekleme ve kaldırma. | Evet |
| 7 | Her iki sunucuda **HTTPS** | Token her istekte gönderilir. | Evet |
| 8 | Ters vekil sunucu (reverse proxy) `Authorization` header'ını iletiyor | Aksi halde istekler 401 alır. | Evet (proxy varsa) |
| 9 | Obsidian'ın çalıştığı cihazdan iki sunucuya da ağ erişimi | İstekler sunucudan değil, kullanıcının cihazından gider. | Evet |
| 10 | Token sahibinin OpenProject hesabının **XWiki'ye OAuth ile bağlı** olması | Bağlantı yoksa mevcut bağlantıların listesi okunamayabilir; bkz. [8. madde](#8-xwiki-hesap-bağlantısı-oauth). | Şiddetle önerilir |
| 11 | XWiki özel (private) IP'deyse OpenProject'in **SSRF izin listesinde** | Entegrasyonun kendisi için gereklidir. | Özel IP varsa |

## 1. Sürüm ve lisans

- **OpenProject 17.6 veya üzeri** gerekir. Kullanılan API, OpenProject kaynak kodunda 17.6, 17.7, 17.8 ve 17.9 sürüm
  dallarında bulunmaktadır.
- OpenProject belgelerine göre özellik bir Enterprise eklentisidir ve Enterprise cloud veya Enterprise on-premises
  kurulumlarında **Corporate** planıyla kullanılabilir.

**Doğrulama:** OpenProject'te **Yönetim → Bilgi** ekranından sürümü, **Yönetim → Enterprise** ekranından planı kontrol edin.

## 2. XWiki sağlayıcısı (yönetici)

Her iki sistemde de yönetici hakları gerekir:

1. XWiki'de **Administer Wiki → Extensions** ekranından **OpenProject Integration (Pro)** eklentisini kurun.
2. OpenProject'te **Yönetim → Wikis** ekranından XWiki'yi sağlayıcı olarak ekleyin ve etkinleştirin. Ayrıntılar:
   [OpenProject XWiki entegrasyonu](https://www.openproject.org/docs/system-admin-guide/integrations/xwiki/).
3. XWiki özel bir IP adresindeyse OpenProject'te `OPENPROJECT_SSRF_PROTECTION_IP_ALLOWLIST` değişkenine ekleyin.

**Doğrulama:** Bir iş paketini açın; **Wikis** sekmesi görünmeli ve **Wiki page** düğmesiyle bir XWiki sayfası elle
bağlanabilmelidir. Bu adım çalışmıyorsa eklenti de bağlantı kuramaz.

## 3. API token'ı

1. OpenProject'te profil menüsünden **Hesabım → Erişim token'ları** ekranını açın.
2. **API** bölümünden yeni bir token oluşturun ve kopyalayın.
3. Obsidian'da **Ayarlar → XWiki Publisher → OpenProject** bölümündeki **Token** alanında yeni bir secret oluşturup
   token'ı oraya yapıştırın.

Güvenlik, XWiki token'ı ile aynı şekilde sağlanır:

- Token Obsidian'ın **secret storage** alanında tutulur; eklentinin `data.json` dosyasına yazılmaz.
- Token yalnızca ayarlardaki OpenProject adresine, `Authorization: Bearer <token>` header'ı ile gönderilir.
- İstek header'ları hiçbir zaman loglanmaz.
- Adres `http://` ile başlıyorsa bağlantı testi, token'ın şifresiz gittiği konusunda uyarır.

Token, sahibinin tüm yetkileriyle çalışır. Bu yüzden kişisel yönetici hesabı yerine, yalnızca gerekli projelerde yetkili
bir hesabın token'ını kullanın.

## 4. İzinler

Token sahibinin rolünde, bağlantı kurulacak **her projede** şu izinler olmalıdır:

| İzin | Nerede | Ne için |
| --- | --- | --- |
| *View work packages* | İş paketi takibi | İş paketini ve bağlantılarını okuma |
| *Manage wiki page links* (`manage_wiki_page_links`) | İş paketi takibi | Bağlantı ekleme ve kaldırma |
| *Edit work packages* | İş paketi takibi | OpenProject, *Manage wiki page links* için bu izni de şart koşar |

XWiki tarafında token sahibinin yayınlanan sayfalarda en az *view* hakkı olmalıdır; yayınlama için zaten *edit* gerekir.

## 5. Ağ ve proxy

- Obsidian'ın çalıştığı cihaz hem XWiki hem OpenProject adresine erişebilmelidir (gerekiyorsa VPN).
- Mobil cihazlar da aynı erişime ihtiyaç duyar.
- Ters vekil sunucu `Authorization` header'ını silmemelidir.

## 6. Komutlarla doğrulama

Komutlar token'ı komut geçmişine yazmamak için `read -s` kullanır. Adresleri kendi ortamınıza göre değiştirin.

```bash
OP=https://openproject.example.com
XW=https://wiki.example.com/xwiki
read -rs OP_TOKEN    # OpenProject token'ını yapıştırıp Enter'a basın
read -rs XW_TOKEN    # XWiki token'ını yapıştırıp Enter'a basın
```

**Token kabul ediliyor mu?** Yanıtta kendi kullanıcınızın adı görünmelidir.

```bash
curl -sS -H "Authorization: Bearer $OP_TOKEN" "$OP/api/v3/users/me"
```

**XWiki eklentisi kurulu mu?** Yanıtta `instanceId` görünmelidir; 404, eklentinin kurulu olmadığını gösterir.

```bash
curl -sS -H "Authorization: Bearer $XW_TOKEN" -H "Accept: application/json" "$XW/rest/openproject/metadata"
```

**Sayfa kimliği okunuyor mu?** Yanıtta `id` görünmelidir. `xwiki:Main.WebHome` yerine var olan bir sayfa da yazabilirsiniz.

```bash
curl -sS -G -H "Authorization: Bearer $XW_TOKEN" -H "Accept: application/json" \
  --data-urlencode "docRef=xwiki:Main.WebHome" "$XW/rest/openproject/documents"
```

**XWiki, OpenProject'te sağlayıcı olarak tanınıyor mu?** `INSTANCE_ID` yerine yukarıdaki `instanceId` değerini yazın.
Beklenen yanıt **200**'dür. 400, bu XWiki'nin etkin bir sağlayıcı olmadığını; 404, OpenProject sürümünün eski olduğunu
gösterir.

```bash
curl -sS -o /dev/null -w "%{http_code}\n" -G -H "Authorization: Bearer $OP_TOKEN" \
  --data-urlencode 'filters=[{"provider":{"operator":"=","values":["INSTANCE_ID"]}},{"identifier":{"operator":"=","values":["xwiki-publisher-connection-test"]}}]' \
  "$OP/api/v3/wiki_page_links"
```

Son olarak Obsidian'da ayarlardan veya panelin **Connection** bölümünden OpenProject için **Test** düğmesine basın.

## 7. Eklentinin kullandığı adresler

| Sunucu | İstek | Amaç |
| --- | --- | --- |
| XWiki | `GET /rest/openproject/metadata` | OpenProject'teki sağlayıcı kimliği olan `instanceId` |
| XWiki | `GET /rest/openproject/documents?docRef=<wiki>:<referans>` | Sayfanın kalıcı kimliği (`id`) |
| OpenProject | `GET /api/v3/users/me` | Bağlantı testi ve bağlantıyı ekleyen kullanıcı |
| OpenProject | `GET /api/v3/wiki_page_links?filters=…` | Sağlayıcı kontrolü (bağlantı testi) |
| OpenProject | `GET /api/v3/work_packages/{id}/wiki_page_links?filters=…` | Mükerrerlik kontrolü ve kaldırılacak bağlantının bulunması |
| OpenProject | `POST /api/v3/work_packages/{id}/wiki_page_links` | Bağlantı ekleme |
| OpenProject | `DELETE /api/v3/wiki_page_links/{id}` | Bağlantı kaldırma |

> **Dikkat:** Bağlantı adresleri OpenProject'in yayımlanmış API belgelerinde yer almaz; kaynak koduna göre
> kullanılmıştır. Sürüm güncellemelerinde değişebilirler. OpenProject'i yükseltirken 6. bölümü yeniden çalıştırın.

## 8. XWiki hesap bağlantısı (OAuth)

OpenProject, bir iş paketinin bağlantılarını listelerken sayfa başlıklarını XWiki'den token sahibinin OAuth bağlantısıyla
okur. Kaynak kod incelemesine göre, token sahibi XWiki hesabını OpenProject'e bağlamamışsa ve iş paketinde eşleşen bir
bağlantı varsa bu liste **500 hatası** döndürebilir. Bu davranış gerçek bir ortamda henüz doğrulanmamıştır.

Olası etkisi:

| İşlem | OAuth bağlantısı yoksa |
| --- | --- |
| Yeni bağlantı ekleme | Çalışır |
| Mükerrerlik kontrolü | Eklenti listeyi okuyamaz. OpenProject aynı bağlantıyı yine reddettiği için **mükerrer kayıt oluşmaz**, ama logda hata görünür. |
| Bağlantı kaldırma | Bağlantı bulunamadığı için **kaldırılamaz**; logda hata görünür. |

**Çözüm:** Token sahibi, bir iş paketinin **Wikis** sekmesinden XWiki hesabını bir kez bağlamalıdır.

## 9. Publish sırasında ne olur

Tekli publish, klasör publish ve Source control publish aynı kuralları uygular:

1. Notta geçen OpenProject iş paketi linkleri bulunur. Kod bloklarındaki linkler ve `%%yorumlar%%` sayılmaz, yalnızca
   ayarlardaki adrese ait linkler dikkate alınır.
2. Publish öncesi XWiki sayfasında bulunup notta artık olmayan linkler için bağlantı **kaldırılır**.
3. Notta bulunan her iş paketi kontrol edilir: bağlantı varsa dokunulmaz (**mükerrer eklenmez**), yoksa **eklenir**.
4. Her not için sonuç, panelin **Recent activity** listesine yazılır.

Tanınan link biçimleri:

```text
https://openproject.example.com/work_packages/123
https://openproject.example.com/wp/123
https://openproject.example.com/projects/demo/work_packages/123/activity
https://openproject.example.com/projects/demo/work_packages/details/123/overview
https://openproject.example.com/work_packages/PROJ-123
```

Bilinmesi gerekenler:

- OpenProject'te **elle eklenmiş** bir bağlantıya, ilgili link dokümandan çıkarılmadıkça dokunulmaz. Aynı iş paketi hem
  elle bağlanmış hem de dokümandan çıkarılmışsa bağlantı kaldırılır.
- Kaldırma işlemi XWiki sayfasının önceki içeriğine bakar. Kaldırma başarısız olursa link o anda sayfadan çıkmış olur
  ve sonraki publish'te yeniden denenmez: logdaki iş paketinden bağlantıyı elle kaldırın.
- Notu silmek bağlantıları kaldırmaz, çünkü not silme işlemi XWiki'ye de yansıtılmaz.
- OpenProject tarafındaki bir hata publish'i bozmaz: sayfa yine kaydedilir, hata logda gösterilir.

## Sorun giderme

| Belirti | Olası neden | Ne yapılmalı |
| --- | --- | --- |
| "Authentication failed (401). Check your OpenProject token." | Token geçersiz veya proxy header'ı siliyor | 3. ve 5. bölümler |
| "XWiki has no OpenProject integration API" | XWiki eklentisi kurulu değil | 2. bölüm |
| "not an enabled wiki provider" | XWiki sağlayıcı olarak tanımlı değil, kapalı veya kimliği farklı | 2. bölüm, 6. bölümdeki son komut |
| "OpenProject has no wiki page link API" | OpenProject 17.6'dan eski | 1. bölüm |
| "Not found (404)" iş paketi için | İş paketi yok veya token sahibi göremiyor | 4. bölüm |
| "Access denied (403)" | *Manage wiki page links* izni yok | 4. bölüm |
| Hata mesajında "could not list the links" | XWiki hesabı OpenProject'e bağlı değil | 8. bölüm |
