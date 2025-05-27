require 'sinatra'
require 'json'

before do
  response.headers['Access-Control-Allow-Origin'] = '*'
  response.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
  response.headers['Access-Control-Allow-Headers'] = 'Origin, Content-Type, Accept, Authorization'
end

options "*" do
  200
end

set :public_folder, File.dirname(__FILE__) + '/static'

get '/' do
  @message = "Welcome chat server"
  erb :index
end

get '/api/api_origins' do
  content_type :json
  {
    "data" => {
      "api_origins" => ["#{request.scheme}://#{request.host}:#{request.port}"]
    }
  }.to_json
end

post '/api/dialog_config' do
  content_type :json
  {data:nil}.to_json
end

post '/api/model_configs' do
  content_type :json
  {data:{option_groups:[]}}.to_json
end

get '/api/remote_config/setting_chatboxai_first' do
  content_type :json
  {data:{setting_chatboxai_first:true}}.to_json
end

get '/api/copilots/list' do
  content_type :json
  json_path = File.expand_path('data/copilots_list.json', __dir__)
  list = JSON.parse(File.read(json_path))
  { data: list }.to_json
end

post '/api/copilots/list' do
  content_type :json
  json_path = File.expand_path('data/copilots_list.json', __dir__)
  list = JSON.parse(File.read(json_path))
  { data: list }.to_json
end

get '/api/copilots/share-record' do
  content_type :json
  {data:nil}.to_json
end

post '/api/copilots/share-record' do
  content_type :json
  {data:nil}.to_json
end

get '/api/remote_config' do
  content_type :json
  {data:{setting_chatboxai_first:true}}.to_json
end
