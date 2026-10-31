#include "PluginEditor.h"
#include "BinaryData.h"

using namespace prism;

namespace {

const char* mimeFor(const juce::String& file) {
  const auto ext = file.fromLastOccurrenceOf(".", false, false).toLowerCase();
  if (ext == "html") return "text/html";
  if (ext == "js") return "text/javascript";
  if (ext == "css") return "text/css";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "json") return "application/json";
  if (ext == "woff2") return "font/woff2";
  if (ext == "woff") return "font/woff";
  return "application/octet-stream";
}

// Linux: the WebView renders on the GPU (patch-juce.cmake), but on NVIDIA
// WebKit cannot share GPU buffers with the window (GBM fails) and shows
// nothing; handing frames over in shared memory works everywhere. Set before
// the WebView's helper process starts, which inherits it. A value the user
// set is kept.
void webkitEnv() {
 #if JUCE_LINUX
  setenv("WEBKIT_DMABUF_RENDERER_FORCE_SHM", "1", 0);
 #endif
}

juce::var valuesObject(const std::array<float, NUM_PARAMS>& v) {
  auto* o = new juce::DynamicObject();
  for (int i = 0; i < NUM_PARAMS; i++) o->setProperty(PARAMS[i].id, v[(size_t)i]);
  return juce::var(o);
}

} // namespace

PrismEditor::PrismEditor(PrismProcessor& p)
  : AudioProcessorEditor(p), proc(p),
    web((webkitEnv(), juce::WebBrowserComponent::Options {})
          .withBackend(juce::WebBrowserComponent::Options::Backend::webview2)
          .withNativeIntegrationEnabled()
          .withKeepPageLoadedWhenBrowserIsHidden()
          .withResourceProvider([this](const juce::String& url) { return resource(url); })
          .withEventListener("prism", [this](const juce::var& msg) { onMessage(msg); })) {
  for (int i = 0; i < NUM_PARAMS; i++) ids[PARAMS[i].id] = i;
  addAndMakeVisible(web);
  // the page is laid out UI_W wide (src/plugin.ts), scaled to this width, and scrolls
  // when this is shorter than the tab; UI_H, the tallest tab, only caps the height
  setResizable(true, true);
  setResizeLimits(UI_W / 2, 360, UI_W * 2, UI_H * 2);
  if (proc.editorW > 0 && proc.editorH > 0) setSize(proc.editorW, proc.editorH);
  else {
    // first open: as wide as the design (or the screen allows, with room for the
    // host's window around it), and as tall as fits, up to the tallest tab
    int w = UI_W, h = UI_H;
    if (auto* d = juce::Desktop::getInstance().getDisplays().getPrimaryDisplay()) {
      w = std::min(UI_W, juce::roundToInt(d->userArea.getWidth() * 0.9));
      h = std::min(juce::roundToInt(UI_H * (double)w / UI_W), juce::roundToInt(d->userArea.getHeight() * 0.85));
    }
    setSize(w, h);
  }
  sized = true;
  web.goToURL(juce::WebBrowserComponent::getResourceProviderRoot());
  startTimerHz(30);
}

void PrismEditor::paint(juce::Graphics& g) { g.fillAll(juce::Colour(0xff050508)); }

void PrismEditor::resized() {
  web.setBounds(getLocalBounds());
  if (sized) { proc.editorW = getWidth(); proc.editorH = getHeight(); }
}

std::optional<juce::WebBrowserComponent::Resource> PrismEditor::resource(const juce::String& url) {
  // BinaryData keeps only file names, and the built UI has no two files with the same name
  auto path = url.upToFirstOccurrenceOf("?", false, false);
  if (path.isEmpty() || path == "/") path = "index.html";
  const auto file = path.fromLastOccurrenceOf("/", false, false);
  for (int i = 0; i < BinaryData::namedResourceListSize; i++) {
    if (file != BinaryData::originalFilenames[i]) continue;
    int size = 0;
    const char* data = BinaryData::getNamedResource(BinaryData::namedResourceList[i], size);
    if (!data) break;
    std::vector<std::byte> bytes((size_t)size);
    std::memcpy(bytes.data(), data, (size_t)size);
    return juce::WebBrowserComponent::Resource { std::move(bytes), mimeFor(file) };
  }
  return std::nullopt;
}

void PrismEditor::send(juce::DynamicObject::Ptr obj) {
  web.emitEventIfBrowserIsVisible("prism", juce::var(obj.get()));
}

void PrismEditor::sendState() {
  for (int i = 0; i < NUM_PARAMS; i++) shown[(size_t)i] = proc.paramValue(i);
  juce::DynamicObject::Ptr o = new juce::DynamicObject();
  o->setProperty("type", "state");
  o->setProperty("values", valuesObject(shown));
  o->setProperty("preset", proc.presetName());
  o->setProperty("last", proc.lastPresetName());
  const auto file = PrismProcessor::userPresetFile();
  o->setProperty("user", file.existsAsFile() ? juce::JSON::parse(file) : juce::var(juce::Array<juce::var>()));
  send(o);
  seenState = proc.stateVersion.load();
}

void PrismEditor::onMessage(const juce::var& msg) {
  const auto type = msg["type"].toString();
  auto idOf = [this](const juce::var& v) {
    const auto it = ids.find(v.toString().toStdString());
    return it == ids.end() ? -1 : it->second;
  };
  if (type == "ready") {
    ready = true;
    sendState();
  } else if (type == "param") {
    const int i = idOf(msg["id"]);
    if (i < 0) return;
    proc.setParamFromUi(i, (double)msg["value"]);
    shown[(size_t)i] = proc.paramValue(i);   // the page already shows it
  } else if (type == "preset") {
    std::array<double, NUM_PARAMS> v {};
    for (int i = 0; i < NUM_PARAMS; i++) v[(size_t)i] = PARAMS[i].def;
    if (auto* obj = msg["values"].getDynamicObject())
      for (auto& prop : obj->getProperties()) {
        const int i = idOf(prop.name.toString());
        if (i >= 0) v[(size_t)i] = (double)prop.value;
      }
    proc.loadValues(v, msg["name"].toString());
    for (int i = 0; i < NUM_PARAMS; i++) shown[(size_t)i] = proc.paramValue(i);
  } else if (type == "current") {
    proc.setPresetName(msg["name"].toString());
  } else if (type == "noteOn") {
    proc.pushUiEvent(PrismProcessor::UiEvent::NoteOn, (int)msg["note"], (float)(double)msg["velocity"]);
  } else if (type == "noteOff") {
    proc.pushUiEvent(PrismProcessor::UiEvent::NoteOff, (int)msg["note"], 0);
  } else if (type == "cc") {
    proc.pushUiEvent(PrismProcessor::UiEvent::Controller, (int)msg["cc"], (float)(double)msg["value"]);
  } else if (type == "bend") {
    proc.pushUiEvent(PrismProcessor::UiEvent::Bend, 0, (float)(double)msg["value"]);
  } else if (type == "panic") {
    proc.pushUiEvent(PrismProcessor::UiEvent::Panic, 0, 0);
  } else if (type == "saveUser") {
    const auto file = PrismProcessor::userPresetFile();
    file.getParentDirectory().createDirectory();
    file.replaceWithText(juce::JSON::toString(msg["presets"]));
  }
}

void PrismEditor::timerCallback() {
  if (!ready) return;
  // the whole sound changed under the page (session load, the host's preset menu)
  if (proc.stateVersion.load() != seenState) { sendState(); return; }

  // parameters the host moved (automation, generic editor)
  juce::DynamicObject::Ptr changed;
  for (int i = 0; i < NUM_PARAMS; i++) {
    const float v = proc.paramValue(i);
    if (v == shown[(size_t)i]) continue;
    shown[(size_t)i] = v;
    if (!changed) changed = new juce::DynamicObject();
    changed->setProperty(PARAMS[i].id, v);
  }
  if (changed) {
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("type", "params");
    o->setProperty("values", juce::var(changed.get()));
    send(o);
  }

  // notes the host or the arp played
  PrismProcessor::NoteEvent evs[256];
  const int count = proc.popNotes(evs, 256);
  if (count > 0) {
    juce::Array<juce::var> list;
    for (int k = 0; k < count; k++) list.add(juce::Array<juce::var> { evs[k].note, evs[k].velocity, evs[k].kind });
    juce::DynamicObject::Ptr o = new juce::DynamicObject();
    o->setProperty("type", "notes");
    o->setProperty("list", list);
    send(o);
  }

  // meters and scope, at the rate the web version gets them
  const auto s = proc.takeStats();
  float scope[1024];
  proc.copyScope(scope);
  juce::Array<juce::var> sc;
  sc.ensureStorageAllocated(1024);
  for (float x : scope) sc.add(std::round(x * 10000) / 10000);
  juce::DynamicObject::Ptr o = new juce::DynamicObject();
  o->setProperty("type", "stats");
  o->setProperty("voices", s.voices);
  o->setProperty("load", s.load);
  o->setProperty("peakL", s.peakL);
  o->setProperty("peakR", s.peakR);
  o->setProperty("tempo", proc.hostTempo.load());
  o->setProperty("scope", sc);
  float display[24];
  proc.copyDisplay(display);
  juce::Array<juce::var> dv;
  for (float x : display) dv.add(x);
  o->setProperty("display", dv);
  send(o);
}
