import Taro from "@tarojs/taro";
import { Button, Text, View } from "@tarojs/components";
import Screen from "../../components/Screen";
import Bear from "../../components/Bear";
import "./home.css";

export default function Page() {
  return (
    <Screen page="home">
      <View className="ui-section panel home-panel">
        <View className="ui-h2">装修工具</View>
        <Text className="ui-p">
          这里放常用的装修决策工具。先用一张户型测量图打底，让你和 B 随时打开看墙、房间与面积。
        </Text>
        <Button
          className="ui-button home-tool-card"
          ariaRole="button"
          onClick={() =>
            Taro.navigateTo({ url: "/pages/floorplan/index" })
          }
          style={{
            border: "none",
            background: "transparent",
            textAlign: "left",
          }}
        >
          <View className="ui-div home-tool-card-inner">
            <View className="ui-div home-tool-card-text">
              <Text className="ui-eyebrow">第一版 · 原始建筑</Text>
              <Text className="ui-h3">户型平面</Text>
              <Text className="ui-p home-tool-card-sub">
                点开看墙、房间与面积。点房间可看详情卡。
              </Text>
            </View>
            <Text className="home-tool-card-arrow ui-mono">→</Text>
          </View>
        </Button>
        <View className="ui-div home-empty">
          <Bear />
          <View className="ui-h3">家在一点点变好</View>
          <View className="ui-p">
            这里是首页的"工具区"，更多工具（报价对比、装修准备清单）后续在这里补上。
          </View>
        </View>
      </View>
    </Screen>
  );
}
