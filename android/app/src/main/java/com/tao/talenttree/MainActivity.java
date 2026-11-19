package com.tao.talenttree;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        if (BuildConfig.GITHUB_UPDATES) registerPlugin(AppUpdatesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
