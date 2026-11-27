package com.xiaoai.phone;

/**
 * 純字串比對邏輯（不碰 Android API，所以可以用 javac + java 直接跑單元測試）。
 *
 * 為什麼要這個：微信聊天列表裡那一行的可見文字通常不是純粹的「陳野」，
 * 而是「陳野 12:30」或「陳野\n昨天 晚安」之類的組合；舊的定位要求文字
 * 完全相等，所以「點進某個對話」這一類動作永遠找不到控件，表現就是
 * 使用者說的「點不動、點不進去」。
 *
 * 規則是：先嚴格相等，再「開頭就是」，最後「包含」；同一輪裡優先取
 * 文字最短的那個（最像名字本身）。同一 tier、同一長度的不同文字
 * 視為模稜，回 AMBIGUOUS 讓上層停下來問，而不是亂點一個。
 */
public final class TapMatch {

    public static final int NONE = -1;
    public static final int AMBIGUOUS = -2;

    /** 模糊匹配時一律跳過危險字：寧可找不到，也不誤點發送/刪除。 */
    private static final String RISK =
            "(發送|发|發送消息|送出|發表|发表|發布|发布|付款|支付|下單|下单|轉帳|转账|轉賬|转账|提現|提现"
            + "|刪除|删除|移除|退訂|退订|群發|群发|支付寶|支付宝|bank|pay|purchase|delete|remove|transfer)";

    private TapMatch() {}

    /** 去空白（含全形空格）+ 小寫化，讓「陳\n野 12:30」跟「陳野」比得起來。 */
    public static String norm(String s) {
        if (s == null) return "";
        StringBuilder b = new StringBuilder(s.length());
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == ' ' || c == '\n' || c == '\r' || c == '\t' || c == '\f' || c == '　') continue;
            b.append(Character.toLowerCase(c));
        }
        return b.toString();
    }

    /** 0=不匹配 1=完全相同 2=開頭就是 3=包含 */
    public static int tier(String target, String text) {
        String t = norm(target), x = norm(text);
        if (t.isEmpty() || x.isEmpty()) return 0;
        if (x.equals(t)) return 1;
        if (x.startsWith(t)) return 2;
        if (x.contains(t)) return 3;
        return 0;
    }

    public static boolean risky(String text) {
        String x = norm(text);
        return x.isEmpty() ? false : x.matches("(?s).*" + RISK + ".*");
    }

    /**
     * texts 應該是「已經按文字去重」的候選清單。
     * @return 候選索引、NONE（沒有任何匹配）或 AMBIGUOUS（有勢均力敵的多個）
     */
    public static int choose(String target, String[] texts) {
        if (target == null || texts == null || texts.length == 0) return NONE;
        String t = norm(target);
        if (t.isEmpty()) return NONE;

        int best = -1, bestTier = 9, bestLen = Integer.MAX_VALUE, tie = 0;
        for (int i = 0; i < texts.length; i++) {
            String raw = texts[i];
            if (risky(raw)) continue;                       // 模糊模式不碰危險按鈕
            int tier = tier(t, raw);
            if (tier == 0) continue;
            int len = norm(raw).length();
            if (tier < bestTier || (tier == bestTier && len < bestLen)) {
                best = i; bestTier = tier; bestLen = len; tie = 1;
            } else if (tier == bestTier && len == bestLen) {
                tie++;
            }
        }
        if (best < 0) return NONE;
        if (bestTier == 1) return best;                     // 完全相同，不需要猶豫
        return tie > 1 ? AMBIGUOUS : best;                  // 包含/前綴只有一個才敢點
    }
}
