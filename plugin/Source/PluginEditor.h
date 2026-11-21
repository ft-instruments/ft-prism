// The editor is the web UI (../dist, embedded as binary data) in a WebView.
// It talks to the page over one event channel, "prism", in both
// directions; src/plugin.ts is the other end.
#pragma once

#include <juce_gui_extra/juce_gui_extra.h>
#include <optional>
#include <unordered_map>
#include "PluginProcessor.h"

class PrismEditor final : public juce::AudioProcessorEditor, private juce::Timer {
public:
  explicit PrismEditor(PrismProcessor&);
  ~PrismEditor() override = default;

  void paint(juce::Graphics&) override;
  void resized() override;

private:
  void timerCallback() override;
  void onMessage(const juce::var& msg);
  void send(juce::DynamicObject::Ptr obj);
  void sendState();
  std::optional<juce::WebBrowserComponent::Resource> resource(const juce::String& url);

  PrismProcessor& proc;
  juce::WebBrowserComponent web;
  std::array<float, prism::NUM_PARAMS> shown {};   // the value the page last heard about
  std::unordered_map<std::string, int> ids;
  static constexpr int UI_W = 1360, UI_H = 850;   // matches src/plugin.ts
  bool ready = false;
  bool sized = false;   // resizes before this are ours, not the user's
  int seenState = -1;

  JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PrismEditor)
};
