import { Text, View } from "@tarojs/components";
export default function Bear({ large = false }: { large?: boolean }) {
  return (
    <View className={`ui-div ${`bear ${large ? "bear-large" : ""}`}`}>
      <View className="ui-i ear left" />
      <View className="ui-i ear right" />
      <View className="ui-div bear-face">
        <View className="ui-i eye left" />
        <View className="ui-i eye right" />
        <View className="ui-i cheek left" />
        <View className="ui-i cheek right" />
        <View className="ui-div muzzle">
          <View className="ui-i" />
        </View>
      </View>
      {large && (
        <>
          <View className="ui-div bear-body" />
          <View className="ui-div bear-arm" />
          <View className="ui-div bear-note">
            HOME<Text className="ui-break">{"\n"}</Text>
            <Text className="ui-span">♡</Text>
          </View>
        </>
      )}
    </View>
  );
}
