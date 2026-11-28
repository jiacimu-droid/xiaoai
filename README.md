# 小愛機 Android 版（v1216）

保留原 HTML 桌面、聊天、設定與辦事卡片，僅增添 Android WebView 外殼及現有 `window.__xaAct` 的原生操作橋接。與 Lulu1 使用不同包名 `com.xiaoai.phone`。

## 構建
推送至 `main` 後，`.github/workflows/apk.yml` 自動執行 JavaScript 測試、Gradle APK 構建及簽名驗證；成功後發布 Actions Artifact 和 GitHub Release 中可直接下載的 APK。亦可從 Actions 手動執行。此版本使用專案固定的測試簽名，不得用作正式商業發行簽名。請將倉庫設為 Private 並取得原作者同意。

## 功能範圍
- 設置 → AI 幫你操作手機（辦事）→ 授權無障礙。也可直接在 Android 無障礙設置啟用「小愛機 · 手機操作」。總開關和角色開關可單獨停用辦事。
- 在角色對話裡說「幫我看一下 QQ」「幫我打開小紅書」即可啟動相應任務。原生操作作用於解鎖手機上的任務目標 App。關閉授權、停止任務或切到不相關的 App 時中止操作。
- 支援啟動 App、點擊、長按、滑動、輸入、返回、讀取控制項和核對執行結果。明確要求發送時，角色可在 QQ 或微信從指定會話發文字消息，也可在微信發文字朋友圈。缺少收件人或內容時會先問。已點提交但結果未核實時會結束任務，避免重發。所需的可見內容可能傳到設定的模型 API。
- `screenshot` 讀取控件文字，Android 14 以上可用 `capture_window` 讀取目前應用窗口的圖片。無障礙使用前台畫面。原 HTML 瀏覽器資料可先匯出備份，再在 APK 匯入。

## 驗證
本地 `node --test tests/phone-bridge.test.cjs` 與改動的內嵌 JavaScript 語法檢查通過。Android 編譯和真機互動尚待 GitHub Actions 與裝置驗證。請先測試普通 App 的搜尋框、點擊、長按、滑動和返回，再評估其他 App。

## 語音轉文字
聊天標題列的「語音轉文字」使用 Android 原生麥克風錄音，完成後才將音訊直接送往 ElevenLabs Scribe API。輸入自己的 STT API Key（僅本機私有設定保存），可選自動、粵語、普通話或英文；可先編輯轉寫結果，再填入聊天輸入框或複製。不會自動發送訊息；離開錄音畫面會取消未提交錄音。既有語音及 TTS 設定保持不變。服務用量依 ElevenLabs 帳戶計費。
