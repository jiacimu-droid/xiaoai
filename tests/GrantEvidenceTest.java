package com.xiaoai.phone;
public final class GrantEvidenceTest {
    public static void main(String[] args){
        int Y=GrantEvidence.YES,N=GrantEvidence.NO,U=GrantEvidence.UNKNOWN;
        int[][] cases={{Y,Y,Y},{Y,N,Y},{N,Y,Y},{Y,U,Y},{U,Y,Y},{N,N,N},{N,U,U},{U,N,U},{U,U,U}};
        for(int[] c:cases){
            if(GrantEvidence.resolve(c[0],c[1])!=c[2])throw new AssertionError("grant evidence "+c[0]+"/"+c[1]);
        }
        if(!GrantEvidence.conflict(Y,N)||!GrantEvidence.conflict(N,Y)||GrantEvidence.conflict(U,N)||GrantEvidence.conflict(Y,Y))
            throw new AssertionError("grant conflict");
        System.out.println("Grant evidence matrix passed");
    }
}
