# 小愛機 Android 版（v1216）

保留原 HTML 桌面、聊天、設定與辦事卡片，僅增添 Android WebView 外殼及現有 `window.__xaAct` 的原生操作橋接。與 Lulu1 使用不同包名 `com.xiaoai.phone`。

## 構建
推送至 `main` 後，`.github/workflows/apk.yml` 自動執行 JavaScript 測試、Gradle APK 構建及簽名驗證；成功後發布 Actions Artifact 和 GitHub Release 中可直接下載的 APK。亦可從 Actions 手動執行。此版本使用專案固定的測試簽名，不得用作正式商業發行簽名。請將倉庫設為 Private 並取得原作者同意。

## 功能範圍
- 設置 → AI 幫你操作手機（辦事）→ 授權無障礙；保留原總開關與角色對話設置開關。
- 原 `xaTaskEntry → xaLoop → xaExec → __xaAct` 流程真正連接 Android。原生操作只在手機解鎖、使用者確認的可見前台 App 生效。單一 App 授權最長三分鐘；關閉授權、停止任務或進入其他 App 不再執行。
- 支援啟動已安裝 App、按文字/相對座標點擊、長按、滑動、聚焦欄位輸入、返回、讀取無障礙控制項文字及真實執行回報。`screenshot` 沿用原 HTML 的文字觀察語義，不返回圖片。發送、付款和提交請使用者自己操作。任務結果可能傳到設定的模型 API，請勿用於敏感畫面。
- 不具備獨立虛擬屏、鎖屏執行、保活保證、Shizuku、真實圖片截圖或完整 WebView 相容性驗證。原 HTML 瀏覽器資料不會自動遷移，請先匯出備份，再在 APK 匯入。

## 驗證
本地 `node --test tests/phone-bridge.test.cjs` 與改動的內嵌 JavaScript 語法檢查通過。Android 編譯和真機互動尚待 GitHub Actions 與裝置驗證。請先測試普通 App 的搜尋框、點擊、長按、滑動和返回，再評估其他 App。
