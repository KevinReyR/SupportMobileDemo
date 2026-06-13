import React from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";

export interface PdfViewerProps {
  uri: string;
  onLoad?: () => void;
  onError: (message: string) => void;
}

export default function PdfViewer({ uri, onLoad, onError }: PdfViewerProps) {
  const openDocument = async () => {
    try {
      await Linking.openURL(uri);
      onLoad?.();
    } catch (error) {
      onError(error instanceof Error ? error.message : "No fue posible abrir el PDF.");
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Vista previa disponible en la aplicación móvil</Text>
      <Text style={styles.body}>
        En web, el documento se abre en una pestaña protegida mediante una URL temporal.
      </Text>
      <Pressable style={styles.button} onPress={openDocument}>
        <Text style={styles.buttonText}>Abrir documento PDF</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
    padding: 28,
    backgroundColor: "#F4F6FA",
  },
  title: { color: "#17213A", fontSize: 18, fontWeight: "800", textAlign: "center" },
  body: { color: "#677187", fontSize: 13, lineHeight: 20, textAlign: "center" },
  button: {
    minHeight: 50,
    borderRadius: 15,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#15285A",
  },
  buttonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "800" },
});

