package com.xiaoai.phone;

/** Reconcile independent sources. Only a live service callback permits operations. */
final class GrantEvidence {
    static final int UNKNOWN=-1, NO=0, YES=1;
    static int resolve(int secure, int manager) {
        if (secure==YES || manager==YES) return YES;
        if (secure==NO && manager==NO) return NO;
        return UNKNOWN;
    }
    static boolean conflict(int secure, int manager) {
        return secure!=UNKNOWN && manager!=UNKNOWN && secure!=manager;
    }
    static String label(int value) {
        return value==YES?"是":value==NO?"否":"無法讀取";
    }
}
